import { decodeEventLog, type Abi, type Address, type Log } from "viem";
import {
  ASSETS,
  assetFactoryAbi,
  bondVaultAbi,
  brokerRegistryAbi,
  complianceAbi,
  exchangeAbi,
  formatTokens,
  formatUsd6,
  levelBookAbi,
  pledgeRegistryAbi,
  priceOracleAbi,
  redemptionEngineAbi,
  roleRegistryAbi,
  sessionClockAbi,
  stockTokenAbi,
} from "@bullstreet/shared";
import { addNotice, kvGet, kvSet } from "@bullstreet/shared/db";
import { d, db, log, publicClient, read } from "./ctx";

/** Every protocol event goes into the `events` table; some also become in-app notices. */
const sources: { name: string; address: Address; abi: Abi }[] = [
  { name: "sessionClock", address: d.sessionClock, abi: sessionClockAbi as Abi },
  { name: "priceOracle", address: d.priceOracle, abi: priceOracleAbi as Abi },
  { name: "compliance", address: d.compliance, abi: complianceAbi as Abi },
  { name: "roles", address: d.roles, abi: roleRegistryAbi as Abi },
  { name: "assets", address: d.assets, abi: assetFactoryAbi as Abi },
  { name: "bondVault", address: d.bondVault, abi: bondVaultAbi as Abi },
  { name: "brokers", address: d.brokers, abi: brokerRegistryAbi as Abi },
  { name: "levelBook", address: d.levelBook, abi: levelBookAbi as Abi },
  { name: "pledges", address: d.pledges, abi: pledgeRegistryAbi as Abi },
  { name: "redemption", address: d.redemption, abi: redemptionEngineAbi as Abi },
  { name: "exchange", address: d.exchange, abi: exchangeAbi as Abi },
  ...d.tokens.map((t, i) => ({ name: `token${i + 1}`, address: t, abi: stockTokenAbi as Abi })),
];
const byAddress = new Map(sources.map((s) => [s.address.toLowerCase(), s]));
const SKIP = new Set(["Transfer", "Approval", "LedgerChanged", "LevelChanged", "NonceUsedBy", "ExposureChanged", "WiringRefreshed"]);
const CHUNK = BigInt(process.env.INDEX_CHUNK ?? 5000);

const ser = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));

export async function indexTick(): Promise<number> {
  const head = await publicClient.getBlockNumber({ cacheTime: 0 });
  let from = BigInt(kvGet(db, "indexer.next") ?? d.deployBlock ?? 0);
  let total = 0;
  while (from <= head) {
    const to = from + CHUNK - 1n < head ? from + CHUNK - 1n : head;
    const logs = await publicClient.getLogs({ address: sources.map((s) => s.address), fromBlock: from, toBlock: to });
    const tsCache = new Map<bigint, number>();
    const insert = db.prepare(
      "INSERT OR IGNORE INTO events(block, tx, log_index, ts, contract, name, args) VALUES(?, ?, ?, ?, ?, ?, ?)",
    );
    for (const l of logs as Log[]) {
      const src = byAddress.get(l.address.toLowerCase());
      if (!src) continue;
      let decoded: { eventName: string; args: any };
      try {
        decoded = decodeEventLog({ abi: src.abi, data: l.data, topics: l.topics }) as any;
      } catch {
        continue;
      }
      if (SKIP.has(decoded.eventName)) continue;
      let ts = tsCache.get(l.blockNumber!);
      if (ts === undefined) {
        ts = Number((await publicClient.getBlock({ blockNumber: l.blockNumber! })).timestamp);
        tsCache.set(l.blockNumber!, ts);
      }
      const res = insert.run(Number(l.blockNumber), l.transactionHash, l.logIndex, ts, src.name, decoded.eventName, ser(decoded.args));
      if (res.changes) {
        total++;
        await notify(decoded.eventName, decoded.args, `${l.transactionHash}:${l.logIndex}`).catch((e) => log("notify", String(e)));
      }
    }
    kvSet(db, "indexer.next", String(to + 1n));
    from = to + 1n;
  }
  return total;
}

const sym = (assetId: unknown) => ASSETS.find((a) => a.id === Number(assetId))?.symbol ?? "tokens";

async function holderOf(ticketId: bigint): Promise<string | undefined> {
  const t = await read<any>(d.redemption, redemptionEngineAbi, "ticketOf", [ticketId]);
  return t.holder.toLowerCase() === d.redemption.toLowerCase() ? undefined : t.holder;
}

async function allocTicket(allocId: bigint) {
  const a = await read<any>(d.redemption, redemptionEngineAbi, "allocationOf", [allocId]);
  return { alloc: a, holder: await holderOf(a.ticketId) };
}

async function notify(name: string, a: any, ref: string) {
  switch (name) {
    case "PledgeAttested": {
      const p = await read<any>(d.pledges, pledgeRegistryAbi, "pledgeOf", [a.pledgeId]);
      addNotice(db, { wallet: p.minter, kind: "pledge", title: `Pledge #${a.pledgeId} is active`, body: `Your broker confirmed ${a.quantity} shares. You can mint against them now.`, link: "/mint", ref });
      break;
    }
    case "PledgeOpened":
      addNotice(db, { wallet: a.broker, kind: "pledge", title: `New pledge #${a.pledgeId}`, body: `${a.shares} shares of ${sym(a.assetId).slice(1)} are being pledged to you.`, link: "/broker", ref });
      break;
    case "AllocationCreated":
      if (BigInt(a.pledgeId) === 0n) break;
      addNotice(db, {
        wallet: a.minter,
        kind: "redemption",
        title: `Redemption on pledge #${a.pledgeId}`,
        body: `${formatTokens(a.units)} of your backing was assigned to a redemption. Pay before ${new Date(Number(a.cureDeadline) * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST to keep your shares, or your broker will sell them.`,
        link: "/mint",
        ref,
      });
      addNotice(db, { wallet: a.broker, kind: "redemption", title: `Allocation #${a.allocId} to settle`, body: `Sell ${formatTokens(a.units)} shares after the cure deadline and settle by the soft deadline.`, link: "/broker", ref: `${ref}:b` });
      break;
    case "Cured":
    case "Settled":
    case "DefaultClaimed":
    case "ReservePaid": {
      const { holder } = await allocTicket(a.allocId);
      const amount = a.toHolder ?? a.paid ?? 0n;
      if (holder) addNotice(db, { wallet: holder, kind: "payout", title: "Redemption paid", body: `You received ${formatUsd6(amount)} USDC.`, link: "/redeem", ref });
      break;
    }
    case "BatchClaimed":
      addNotice(db, { wallet: a.holder, kind: "payout", title: "Batched redemption paid", body: `You received ${formatUsd6(a.amount)} USDC.`, link: "/redeem", ref });
      break;
    case "OrderFilled":
      addNotice(db, { wallet: a.maker, kind: "trade", title: `Order #${a.id} filled`, body: `${formatTokens(a.amount)} ${sym(a.assetId)} for ${formatUsd6(a.usdc)} USDC.`, link: "/trade", ref });
      break;
    case "ReleaseRequested": {
      const p = await read<any>(d.pledges, pledgeRegistryAbi, "pledgeOf", [a.pledgeId]);
      addNotice(db, { wallet: p.broker, kind: "pledge", title: `Release requested on #${a.pledgeId}`, body: `Unpledge ${formatTokens(a.units)} shares and confirm before the deadline.`, link: "/broker", ref });
      break;
    }
    case "ReleaseConfirmed": {
      const p = await read<any>(d.pledges, pledgeRegistryAbi, "pledgeOf", [a.pledgeId]);
      addNotice(db, { wallet: p.minter, kind: "pledge", title: `Shares released from #${a.pledgeId}`, body: `${formatTokens(a.units)} shares are back in your free balance.`, link: "/mint", ref });
      break;
    }
    case "BrokerStatusChanged":
      addNotice(db, { wallet: a.broker, kind: "broker", title: "Broker status changed", body: `Your status is now ${["None", "awaiting bond", "active", "draining", "defaulted", "exited"][Number(a.to)]}.`, link: "/broker", ref });
      break;
  }
}
