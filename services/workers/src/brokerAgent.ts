import { keccak256, toHex, type Address } from "viem";
import {
  AllocStatus,
  PledgeStatus,
  assetById,
  domain,
  paramKey,
  paramsAbi,
  pledgeAttestationTypes,
  pledgeRegistryAbi,
  priceOracleAbi,
  randomNonce,
  redemptionEngineAbi,
  releaseConfirmationTypes,
  saleReportTypes,
  brokerRegistryAbi,
  sessionClockAbi,
} from "@bullstreet/shared";
import { agreementFor, getPledge, invoke, pledgeByAgreement, release, remainingOf } from "@bullstreet/shared/depository";
import { kvGet, kvSet } from "@bullstreet/shared/db";
import { CHAIN_ID, brokerAgents, d, db, errMsg, log, nowSec, read, send , syncClock } from "./ctx";

/**
 * A broker's automated desk (one per broker key pair). It does what the broker's back office would:
 *   1. accepts pledges that arrived in its CDSL account and attests to them on-chain;
 *   2. after a redemption's cure deadline, invokes and sells the pledged shares, then settles at the close;
 *   3. unpledges on release requests and confirms them;
 *   4. re-attests every pledge before its attestation runs low;
 *   5. pokes its own health.
 * The agent signs with the broker's delegate key; settlement money comes from the broker's main wallet.
 */
export async function brokerTick(): Promise<void> {
  await syncClock();
  for (const b of brokerAgents()) {
    try {
      await runBroker(b.main.address, b.agent, b.name);
    } catch (e) {
      log(`broker:${b.name}`, errMsg(e));
    }
  }
}

async function runBroker(broker: Address, agent: ReturnType<typeof brokerAgents>[number]["agent"], name: string) {
  const info = await read<any>(d.brokers, brokerRegistryAbi, "brokerOf", [broker]);
  if (Number(info.status) === 0) return;
  if (info.delegate.toLowerCase() !== agent.address.toLowerCase()) return; // the agent only acts once delegated
  const ttl = Number(await read<bigint>(d.params, paramsAbi, "get", [paramKey("ATTEST_TTL")]));
  const ids = await read<bigint[]>(d.pledges, pledgeRegistryAbi, "pledgesByBroker", [broker]);

  for (const id of ids) {
    const p = await read<any>(d.pledges, pledgeRegistryAbi, "pledgeOf", [id]);
    const dp = pledgeByAgreement(db, agreementFor(id));
    const asset = assetById(Number(p.assetId))!;
    const shares = (x: bigint) => x / 10n ** 18n;

    // 1. attest accepted connected pledges
    if (Number(p.status) === PledgeStatus.Pending && dp && dp.status === "ACCEPTED" && !dp.guided) {
      if (BigInt(dp.qty) !== shares(p.q)) continue;
      await attest(agent, id, p.minter, dp.psn, asset.isin, BigInt(dp.qty), ttl, "attestPledge");
      log(`broker:${name}`, `attested pledge #${id} (${dp.psn})`);
      continue;
    }
    if (Number(p.status) !== PledgeStatus.Active || !dp) continue;

    // 3. releases
    if (p.pendingRelease > 0n && !dp.guided) {
      const qty = Number(shares(p.pendingRelease));
      const key = `release:${id}:${p.released}`;
      if (!kvGet(db, key) && remainingOf(dp) >= qty) {
        release(db, dp.psn, qty);
        kvSet(db, key, "1");
      }
      if (kvGet(db, key)) {
        const c = { pledgeId: id, quantity: BigInt(qty), nonce: randomNonce() };
        const sig = await agent.signTypedData({ domain: domain(CHAIN_ID, d.pledges), types: releaseConfirmationTypes, primaryType: "ReleaseConfirmation", message: c });
        await send(agent, d.pledges, pledgeRegistryAbi, "confirmRelease", [c, sig]);
        log(`broker:${name}`, `released ${qty} from pledge #${id}`);
      }
    }

    // 4. re-attest before the attestation gets low
    if (Number(p.attestedUntil) - nowSec() < ttl / 2) {
      const fresh = getPledge(db, dp.psn)!;
      await attest(agent, id, p.minter, dp.psn, asset.isin, BigInt(remainingOf(fresh)), ttl, "reattest");
      log(`broker:${name}`, `re-attested pledge #${id}`);
    }
  }

  // 2. settle allocations on this broker's pledges
  await settleAllocations(broker, agent, name);
}

async function attest(
  agent: ReturnType<typeof brokerAgents>[number]["agent"],
  pledgeId: bigint,
  minter: Address,
  psn: string,
  isin: string,
  quantity: bigint,
  ttl: number,
  fn: "attestPledge" | "reattest",
) {
  const a = {
    pledgeId,
    psnHash: keccak256(toHex(psn)),
    isinHash: keccak256(toHex(isin)),
    quantity,
    minter,
    validUntil: BigInt(nowSec() + ttl - 120),
    nonce: randomNonce(),
  };
  const sig = await agent.signTypedData({ domain: domain(CHAIN_ID, d.pledges), types: pledgeAttestationTypes, primaryType: "PledgeAttestation", message: a });
  await send(agent, d.pledges, pledgeRegistryAbi, fn, [a, sig]);
}

async function settleAllocations(broker: Address, agent: ReturnType<typeof brokerAgents>[number]["agent"], name: string) {
  const rows = db
    .prepare("SELECT args FROM events WHERE name = 'AllocationCreated' ORDER BY block DESC LIMIT 1000")
    .all() as { args: string }[];
  const open = await read<boolean>(d.sessionClock, sessionClockAbi, "isOpen");
  for (const r of rows) {
    const ev = JSON.parse(r.args);
    if (String(ev.broker).toLowerCase() !== broker.toLowerCase() || ev.pledgeId === "0") continue;
    const allocId = BigInt(ev.allocId);
    const al = await read<any>(d.redemption, redemptionEngineAbi, "allocationOf", [allocId]);
    if (Number(al.status) !== AllocStatus.Assigned) continue;
    if (nowSec() < Number(al.cureDeadline)) continue;
    const t = await read<any>(d.redemption, redemptionEngineAbi, "ticketOf", [al.ticketId]);
    const dp = pledgeByAgreement(db, agreementFor(al.pledgeId));
    if (!dp || dp.guided) continue;
    const qty = Number(al.units / 10n ** 18n);

    // invoke and sell during the reference session
    const invKey = `invoke:${allocId}`;
    if (!kvGet(db, invKey) && open) {
      invoke(db, dp.psn, qty);
      kvSet(db, invKey, "1");
      log(`broker:${name}`, `invoked ${qty} shares on ${dp.psn} for allocation #${allocId}`);
    }
    if (!kvGet(db, invKey)) continue;

    const refClose = await read<bigint>(d.priceOracle, priceOracleAbi, "closeAt", [t.assetId, al.refSession]);
    if (refClose === 0n) continue; // settle once the session's close is posted
    // sale near the close (within 0.3%)
    const drift = 1 + (Math.random() - 0.5) * 0.006;
    const gross = BigInt(Math.floor(Number(refClose) * qty * drift));
    const report = { allocationId: allocId, quantity: BigInt(qty), grossProceeds: gross, saleTime: BigInt(nowSec()), nonce: randomNonce() };
    const sig = await agent.signTypedData({ domain: domain(CHAIN_ID, d.redemption), types: saleReportTypes, primaryType: "SaleReport", message: report });
    try {
      await send(agent, d.redemption, redemptionEngineAbi, "settle", [report, sig]);
      log(`broker:${name}`, `settled allocation #${allocId}: ${qty} shares for $${Number(gross) / 1e6}`);
    } catch (e) {
      log(`broker:${name}`, `settle #${allocId} failed: ${errMsg(e)}`);
    }
  }
}
