/**
 * End-to-end lifecycle on a local chain (anvil), fast-forwarding time between steps:
 *   buy on the order book -> redeem (broker settles) -> redeem (minter cures) -> small redemption (batched)
 *   -> redeem (broker misses the deadline, bond pays).
 * Runs the workers' jobs directly. Requires: pnpm chain, pnpm deploy:local, pnpm seed.
 *
 *   CHAIN_ID=31337 RPC_URL=http://127.0.0.1:8545 pnpm e2e
 */
import { maxUint256, type Address } from "viem";
import {
  AllocStatus,
  BrokerStatus,
  Side,
  TicketStatus,
  brokerRegistryAbi,
  exchangeAbi,
  mockUsdcAbi,
  pledgeRegistryAbi,
  redemptionEngineAbi,
  stockTokenAbi,
} from "../services/shared/src/index";
import { persona } from "../services/shared/src/node";
import { CHAIN_ID, d, publicClient, read, send, syncClock } from "../services/workers/src/ctx";
import { indexTick } from "../services/workers/src/indexer";
import { oracleTick } from "../services/workers/src/oracle";
import { brokerTick } from "../services/workers/src/brokerAgent";
import { keeperTick } from "../services/workers/src/keeper";

if (CHAIN_ID !== 31337) throw new Error("e2e runs on a local chain only (it moves time forward)");
const REL = 1;
const ONE = 10n ** 18n;
const bob = persona("bob");
const eve = persona("eve");
const token = d.tokens[0];
let failures = 0;

function check(cond: boolean, msg: string) {
  console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`);
  if (!cond) failures++;
}

async function warpTo(ts: number) {
  const b = await publicClient.getBlock();
  const now = Number(b.timestamp);
  if (ts > now) {
    await publicClient.request({ method: "evm_increaseTime" as any, params: [ts - now] as any });
    await publicClient.request({ method: "evm_mine" as any, params: [] as any });
  }
  await syncClock();
}

async function alloc(id: bigint) {
  return read<any>(d.redemption, redemptionEngineAbi, "allocationOf", [id]);
}

async function redeem(who: typeof bob, shares: bigint) {
  const { result } = await publicClient.simulateContract({
    account: who,
    address: d.redemption,
    abi: redemptionEngineAbi,
    functionName: "requestRedemption",
    args: [REL, shares * ONE, []],
  });
  await send(who, d.redemption, redemptionEngineAbi, "requestRedemption", [REL, shares * ONE, []]);
  await indexTick();
  return result as bigint;
}

async function sessionClose(index: number) {
  const s = await read<[bigint, bigint]>(d.sessionClock, [{ type: "function", name: "sessionAt", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint64" }, { type: "uint64" }] }], "sessionAt", [BigInt(index)]);
  return { open: Number(s[0]), close: Number(s[1]) };
}

async function backingHolds() {
  const supply = await read<bigint>(token, stockTokenAbi, "totalSupply");
  const m = await read<bigint>(d.pledges, pledgeRegistryAbi, "totalM", [REL]);
  const unbacked = await read<bigint>(d.pledges, pledgeRegistryAbi, "unbacked", [REL]);
  const [reserve] = await read<[bigint, bigint, bigint]>(d.redemption, redemptionEngineAbi, "reserveOf", [REL]);
  return supply === m + unbacked + reserve;
}

async function main() {
  await syncClock();
  await oracleTick();
  await indexTick();

  console.log("1. Alice lists 50 bRELIANCE; Bob buys them on the order book");
  const alice = persona("alice");
  for (const id of await read<bigint[]>(d.exchange, exchangeAbi, "ordersOf", [alice.address])) {
    const o = await read<any>(d.exchange, exchangeAbi, "getOrder", [id]);
    if (Number(o.status) === 1) await send(alice, d.exchange, exchangeAbi, Number(o.expiry) <= Math.floor(Date.now() / 1000) ? "reclaim" : "cancel", [id]);
  }
  const [pid] = await read<bigint[]>(d.pledges, pledgeRegistryAbi, "pledgesOf", [alice.address]);
  const pa = await read<any>(d.pledges, pledgeRegistryAbi, "pledgeOf", [pid]);
  const spare = (pa.q - pa.m - pa.pendingRelease) / ONE;
  if (spare > 0n) await send(alice, d.pledges, pledgeRegistryAbi, "mint", [pid, spare]);
  const [close] = await read<[bigint, number, bigint]>(d.priceOracle, [{ type: "function", name: "closeOf", stateMutability: "view", inputs: [{ type: "uint32" }], outputs: [{ type: "uint256" }, { type: "uint32" }, { type: "uint64" }] }], "closeOf", [REL]);
  const ask = (close * 10_050n) / 10_000n;
  const { result: restingId } = await publicClient.simulateContract({
    account: alice,
    address: d.exchange,
    abi: exchangeAbi,
    functionName: "trade",
    args: [{ assetId: REL, side: Side.Sell, limitPrice: ask, amount: 50n * ONE, fillIds: [], rest: true, expiry: BigInt(Math.floor(Date.now() / 1000) + 86400), minFilled: 0n }],
  });
  await send(alice, d.exchange, exchangeAbi, "trade", [
    { assetId: REL, side: Side.Sell, limitPrice: ask, amount: 50n * ONE, fillIds: [], rest: true, expiry: BigInt(Math.floor(Date.now() / 1000) + 86400), minFilled: 0n },
  ]);
  await send(bob, d.usdc, mockUsdcAbi, "approve", [d.exchange, maxUint256]);
  await send(bob, token, stockTokenAbi, "approve", [d.redemption, maxUint256]);
  await send(bob, d.exchange, exchangeAbi, "trade", [
    { assetId: REL, side: Side.Buy, limitPrice: ask, amount: 50n * ONE, fillIds: [(restingId as any)[1]], rest: false, expiry: 0n, minFilled: 50n * ONE },
  ]);
  check((await read<bigint>(token, stockTokenAbi, "balanceOf", [bob.address])) >= 50n * ONE, "Bob holds 50 tokens");

  console.log("2. Bob redeems 15: the broker sells at the next session and settles");
  const usdc0 = await read<bigint>(d.usdc, mockUsdcAbi, "balanceOf", [bob.address]);
  const t1 = await redeem(bob, 15n);
  const [a1] = await read<bigint[]>(d.redemption, redemptionEngineAbi, "ticketAllocations", [t1]);
  let al = await alloc(a1);
  console.log(`  allocation #${a1} on pledge #${al.pledgeId}, priced at session ${al.refSession}`);
  await warpTo(Number(al.cureDeadline) + 1);
  await brokerTick(); // invoke during the session
  const ref1 = await sessionClose(Number(al.refSession));
  await warpTo(ref1.close + 1);
  await oracleTick(); // posts the reference close
  await brokerTick(); // settles
  al = await alloc(a1);
  check(Number(al.status) === AllocStatus.Settled, "allocation settled by the broker");
  check((await read<bigint>(d.usdc, mockUsdcAbi, "balanceOf", [bob.address])) > usdc0, "Bob received USDC");
  check(await backingHolds(), "supply = pledged backing + reserve + unbacked");

  console.log("3. Bob redeems 12: the minter pays to keep the shares");
  const t2 = await redeem(bob, 12n);
  const [a2] = await read<bigint[]>(d.redemption, redemptionEngineAbi, "ticketAllocations", [t2]);
  al = await alloc(a2);
  const p2 = await read<any>(d.pledges, pledgeRegistryAbi, "pledgeOf", [al.pledgeId]);
  const minter = ["alice", "carol", "dev"].map((k) => persona(k as any)).find((x) => x.address === p2.minter)!;
  await send(minter, d.usdc, mockUsdcAbi, "approve", [d.redemption, maxUint256]);
  await send(minter, d.redemption, redemptionEngineAbi, "cure", [a2]);
  const ref2 = await sessionClose(Number(al.refSession));
  await warpTo(ref2.close + 1);
  await oracleTick();
  await keeperTick(); // finalizes the cure
  al = await alloc(a2);
  check(Number(al.status) === AllocStatus.Cured, "allocation cured by the minter");
  check(await backingHolds(), "supply = pledged backing + reserve + unbacked");

  console.log("4. Eve redeems 4 (small): batched and paid pro rata");
  await send(bob, token, stockTokenAbi, "transfer", [eve.address, 4n * ONE]);
  await send(eve, token, stockTokenAbi, "approve", [d.redemption, maxUint256]);
  const t3 = await redeem(eve, 4n);
  const tk = await read<any>(d.redemption, redemptionEngineAbi, "ticketOf", [t3]);
  const batch = await read<any>(d.redemption, redemptionEngineAbi, "batchOf", [tk.batchId]);
  const bs = await sessionClose(Number(batch.session));
  await warpTo(bs.open + 1);
  await oracleTick();
  await keeperTick(); // processes the batch
  await indexTick();
  const b2 = await read<any>(d.redemption, redemptionEngineAbi, "batchOf", [tk.batchId]);
  check(b2.processed, "batch processed at the session open");
  const [a3] = await read<bigint[]>(d.redemption, redemptionEngineAbi, "ticketAllocations", [b2.aggTicket]);
  al = await alloc(a3);
  await warpTo(Number(al.cureDeadline) + 1);
  await brokerTick();
  const ref3 = await sessionClose(Number(al.refSession));
  await warpTo(ref3.close + 1);
  await oracleTick();
  await brokerTick();
  const eveUsdc0 = await read<bigint>(d.usdc, mockUsdcAbi, "balanceOf", [eve.address]);
  await send(eve, d.redemption, redemptionEngineAbi, "claimBatch", [t3]);
  check((await read<bigint>(d.usdc, mockUsdcAbi, "balanceOf", [eve.address])) > eveUsdc0, "Eve claimed her share of the batch");
  check(Number((await read<any>(d.redemption, redemptionEngineAbi, "ticketOf", [t3])).status) === TicketStatus.Done, "Eve's ticket is done");

  console.log("5. Bob redeems 10: the broker misses every deadline, the bond pays 105%");
  const t4 = await redeem(bob, 10n);
  const [a4] = await read<bigint[]>(d.redemption, redemptionEngineAbi, "ticketAllocations", [t4]);
  al = await alloc(a4);
  const p4 = await read<any>(d.pledges, pledgeRegistryAbi, "pledgeOf", [al.pledgeId]);
  await warpTo(Number(al.hardDeadline) + 1);
  await oracleTick();
  await keeperTick(); // claims the default
  al = await alloc(a4);
  check(Number(al.status) === AllocStatus.Defaulted, "allocation paid from the bond");
  check(Number(await read(d.brokers, brokerRegistryAbi, "statusOf", [p4.broker as Address])) === BrokerStatus.Defaulted, "broker marked defaulted");
  check(await backingHolds(), "supply = pledged backing + reserve + unbacked");

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
