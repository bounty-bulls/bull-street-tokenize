import type { Address } from "viem";
import {
  ASSETS,
  AllocStatus,
  BrokerStatus,
  OrderStatus,
  PledgeStatus,
  TicketStatus,
  brokerRegistryAbi,
  exchangeAbi,
  levelBookAbi,
  paramKey,
  paramsAbi,
  pledgeRegistryAbi,
  priceOracleAbi,
  redemptionEngineAbi,
  sessionClockAbi,
} from "@bullstreet/shared";
import { processDue } from "@bullstreet/shared/depository";
import { d, db, errMsg, keeperAccount, log, nowSec, read, send } from "./ctx";

/**
 * Permissionless upkeep. Anyone could run these; this keeper just makes sure nobody has to wait:
 * depository processing, batch processing, continuing partial allocations, finalising cures and reserve
 * payouts, default claims, level syncs and broker requeues, pending-pledge expiry, stale slashing and
 * returning expired orders.
 */
export async function keeperTick(): Promise<void> {
  const k = keeperAccount();
  const tryTx = async (label: string, address: Address, abi: any, fn: string, args: readonly unknown[]) => {
    try {
      await send(k, address, abi, fn, args);
      log("keeper", label);
    } catch (e) {
      const m = errMsg(e);
      if (!/NotDue|PriceNotPosted|BatchNotReady|WrongStatus|NothingToAllocate|NotStale|NotYetExpired/.test(m)) log("keeper", `${label} failed: ${m}`);
    }
  };

  // depository: auto-accept requests on business days, reject the ones nobody accepted
  try {
    const ext = await read<boolean>(d.sessionClock, sessionClockAbi, "extendedClosure");
    const ttl = Number(await read<bigint>(d.params, paramsAbi, "get", [paramKey("PENDING_PLEDGE_TTL")]));
    const r = processDue(db, !ext, ttl);
    if (r.accepted.length || r.rejected.length) log("keeper", `depository accepted ${r.accepted.length}, rejected ${r.rejected.length}`);
  } catch (e) {
    log("keeper", `depository: ${errMsg(e)}`);
  }

  // batches whose session has opened
  for (const a of ASSETS) {
    const bid = await read<bigint>(d.redemption, redemptionEngineAbi, "openBatch", [a.id]);
    if (bid === 0n) continue;
    const b = await read<any>(d.redemption, redemptionEngineAbi, "batchOf", [bid]);
    const [open] = await read<[bigint, bigint]>(d.sessionClock, sessionClockAbi, "sessionAt", [BigInt(b.session)]);
    if (nowSec() >= Number(open)) await tryTx(`processed batch #${bid} (${a.ticker})`, d.redemption, redemptionEngineAbi, "processBatch", [a.id, []]);
  }

  // tickets and allocations, from the event index
  const tickets = new Set<string>();
  for (const r of db.prepare("SELECT args FROM events WHERE name IN ('TicketCreated','Requeued','BatchProcessed') ORDER BY block DESC LIMIT 2000").all() as { args: string }[]) {
    const a = JSON.parse(r.args);
    tickets.add(String(a.ticketId));
  }
  for (const tid of tickets) {
    const t = await read<any>(d.redemption, redemptionEngineAbi, "ticketOf", [BigInt(tid)]);
    if (Number(t.status) === TicketStatus.PartiallyAllocated && t.remaining > 0n) {
      await tryTx(`continued ticket #${tid}`, d.redemption, redemptionEngineAbi, "continueAllocation", [BigInt(tid), []]);
    }
  }

  const allocs = db.prepare("SELECT args FROM events WHERE name = 'AllocationCreated' ORDER BY block DESC LIMIT 2000").all() as { args: string }[];
  for (const r of allocs) {
    const ev = JSON.parse(r.args);
    const id = BigInt(ev.allocId);
    const al = await read<any>(d.redemption, redemptionEngineAbi, "allocationOf", [id]);
    const status = Number(al.status);
    if (status !== AllocStatus.Assigned && status !== AllocStatus.CurePending) continue;
    const t = await read<any>(d.redemption, redemptionEngineAbi, "ticketOf", [al.ticketId]);
    const refClose = await read<bigint>(d.priceOracle, priceOracleAbi, "closeAt", [t.assetId, al.refSession]);
    if (status === AllocStatus.CurePending && refClose > 0n) {
      await tryTx(`finalised cure #${id}`, d.redemption, redemptionEngineAbi, "finalizeCure", [id]);
    } else if (al.pledgeId === 0n && refClose > 0n) {
      await tryTx(`paid reserve allocation #${id}`, d.redemption, redemptionEngineAbi, "claimReserve", [id]);
    } else if (status === AllocStatus.Assigned && al.pledgeId > 0n) {
      const brokerStatus = Number(await read<number>(d.brokers, brokerRegistryAbi, "statusOf", [ev.broker]));
      const hardClose = await read<bigint>(d.priceOracle, priceOracleAbi, "closeAt", [t.assetId, al.hardSession]);
      const due =
        (brokerStatus === BrokerStatus.Defaulted && refClose > 0n) || (nowSec() >= Number(al.hardDeadline) && hardClose > 0n);
      if (due) await tryTx(`claimed default on allocation #${id}`, d.redemption, redemptionEngineAbi, "claimDefault", [id]);
    }
  }

  // brokers: health, and requeue pledges of draining or defaulted brokers
  const brokers = await read<Address[]>(d.brokers, brokerRegistryAbi, "brokers");
  for (const b of brokers) {
    const s = Number(await read<number>(d.brokers, brokerRegistryAbi, "statusOf", [b]));
    if (s === BrokerStatus.Active || s === BrokerStatus.Pending) {
      // poke only when it changes something: health below 1.0, or a cure clock running
      const info = await read<any>(d.brokers, brokerRegistryAbi, "brokerOf", [b]);
      const health = await read<bigint>(d.brokers, brokerRegistryAbi, "health", [b]);
      if (health < 10_000n || Number(info.healthLowSince) > 0) await tryTx(`poked ${b.slice(0, 8)}`, d.brokers, brokerRegistryAbi, "poke", [b]);
    }
    if (s === BrokerStatus.Draining || s === BrokerStatus.Defaulted) {
      const key = `requeued:${b}:${s}`;
      const done = db.prepare("SELECT value FROM kv WHERE key = ?").get(key);
      if (!done) {
        await tryTx(`requeued pledges of ${b.slice(0, 8)}`, d.levelBook, levelBookAbi, "requeueBroker", [b, 50n]);
        db.prepare("INSERT OR REPLACE INTO kv(key, value) VALUES(?, '1')").run(key);
      }
    }
  }

  // pledges: at-risk syncs, pending expiry and stale slashing
  const count = Number(await read<bigint>(d.pledges, pledgeRegistryAbi, "count"));
  const atRiskWindow = Number(await read<bigint>(d.params, paramsAbi, "get", [paramKey("ATRISK_WINDOW")]));
  const staleGrace = Number(await read<bigint>(d.params, paramsAbi, "get", [paramKey("STALE_GRACE")]));
  const pendingTtl = Number(await read<bigint>(d.params, paramsAbi, "get", [paramKey("PENDING_PLEDGE_TTL")]));
  const toSync: bigint[] = [];
  for (let i = 1; i <= count; i++) {
    const id = BigInt(i);
    const p = await read<any>(d.pledges, pledgeRegistryAbi, "pledgeOf", [id]);
    const st = Number(p.status);
    if (st === PledgeStatus.Pending && nowSec() > Number(p.openedAt) + pendingTtl) {
      await tryTx(`expired pending pledge #${id}`, d.pledges, pledgeRegistryAbi, "rejectExpired", [id]);
    }
    if (st !== PledgeStatus.Active) continue;
    const [lvl, member] = await read<[number, boolean]>(d.levelBook, levelBookAbi, "levelOf", [id]);
    const shouldBeAtRisk = Number(p.attestedUntil) < nowSec() + atRiskWindow;
    if (member && shouldBeAtRisk && Number(lvl) === 4) toSync.push(id);
    if (member && !shouldBeAtRisk && Number(lvl) === 3) toSync.push(id);
    if (nowSec() > Number(p.attestedUntil) + staleGrace && p.m > p.a) {
      await tryTx(`slashed stale pledge #${id}`, d.pledges, pledgeRegistryAbi, "slashStale", [id]);
    }
  }
  if (toSync.length) await tryTx(`synced ${toSync.length} pledge levels`, d.levelBook, levelBookAbi, "syncMany", [toSync]);

  // exchange: return expired orders' escrow
  for (const a of ASSETS) {
    const n = Number(await read<bigint>(d.exchange, exchangeAbi, "assetOrderCount", [a.id]));
    if (!n) continue;
    const rows = db.prepare("SELECT args FROM events WHERE name = 'OrderPlaced' ORDER BY block DESC LIMIT 500").all() as { args: string }[];
    for (const r of rows) {
      const ev = JSON.parse(r.args);
      if (Number(ev.assetId) !== a.id || Number(ev.expiry) > nowSec()) continue;
      const o = await read<any>(d.exchange, exchangeAbi, "getOrder", [BigInt(ev.id)]);
      if (Number(o.status) === OrderStatus.Open) await tryTx(`returned expired order #${ev.id}`, d.exchange, exchangeAbi, "reclaim", [BigInt(ev.id)]);
    }
  }
}
