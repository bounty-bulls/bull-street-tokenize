import { Hono } from "hono";
import { isAddress, zeroAddress, type Address } from "viem";
import {
  ASSETS,
  Side,
  brokerRegistryAbi,
  bondVaultAbi,
  complianceAbi,
  exchangeAbi,
  levelBookAbi,
  mockUsdcAbi,
  paramsAbi,
  pledgeRegistryAbi,
  priceOracleAbi,
  redemptionEngineAbi,
  roleRegistryAbi,
  sessionClockAbi,
  stockTokenAbi,
} from "@bullstreet/shared";
import { db, deployment, jsonSafe, publicClient } from "../ctx";

/**
 * One read of everything the app shows: calendar, assets with backing and book tops, brokers, and (when a
 * wallet is given) that wallet's balances, pledges, redemptions, orders and the allocations it must act on.
 */
export const snapshot = new Hono();

type Call = { address: Address; abi: any; functionName: string; args?: readonly unknown[] };
const mc = async <T = any>(calls: Call[]): Promise<T[]> =>
  calls.length ? ((await publicClient.multicall({ contracts: calls as any, allowFailure: false })) as T[]) : [];

export async function buildSnapshot(wallet?: Address) {
  const d = deployment();
  const now = Math.floor(Date.now() / 1000);
  const block = await publicClient.getBlock();

  // ---------------------------------------------------------------- calendar and params
  const [count, isOpen, ext, lastClosed, paramsAll] = await mc([
    { address: d.sessionClock, abi: sessionClockAbi, functionName: "count" },
    { address: d.sessionClock, abi: sessionClockAbi, functionName: "isOpen" },
    { address: d.sessionClock, abi: sessionClockAbi, functionName: "extendedClosure" },
    { address: d.sessionClock, abi: sessionClockAbi, functionName: "lastClosedSession" },
    { address: d.params, abi: paramsAbi, functionName: "all" },
  ]);
  const params: Record<string, string> = {};
  const [pk, pv] = paramsAll as [string[], bigint[]];
  pk.forEach((k, i) => {
    params[Buffer.from(k.slice(2), "hex").toString("utf8").replace(/\0+$/, "")] = pv[i].toString();
  });
  const total = Number(count);
  const [found, lastIdx] = lastClosed as [boolean, number];
  const from = Math.max(0, (found ? lastIdx : 0) - 2);
  const sessions = (
    await publicClient.readContract({ address: d.sessionClock, abi: sessionClockAbi, functionName: "sessionsFrom", args: [BigInt(from), 16n] })
  ).map((s: any, i: number) => ({ index: from + i, open: Number(s.openTime), close: Number(s.closeTime) }));
  const current = sessions.find((s) => s.open <= now && now < s.close);
  const next = sessions.find((s) => s.open > now);

  // ---------------------------------------------------------------- assets
  const assetCalls: Call[] = [];
  for (let i = 0; i < ASSETS.length; i++) {
    const id = ASSETS[i].id;
    const token = d.tokens[i];
    assetCalls.push(
      { address: token, abi: stockTokenAbi, functionName: "totalSupply" },
      { address: d.pledges, abi: pledgeRegistryAbi, functionName: "totalM", args: [id] },
      { address: d.pledges, abi: pledgeRegistryAbi, functionName: "unbacked", args: [id] },
      { address: d.redemption, abi: redemptionEngineAbi, functionName: "reserveOf", args: [id] },
      { address: d.priceOracle, abi: priceOracleAbi, functionName: "hasPrice", args: [id] },
      { address: d.priceOracle, abi: priceOracleAbi, functionName: "isStale", args: [id] },
      { address: d.exchange, abi: exchangeAbi, functionName: "lastTradePrice", args: [id] },
      { address: d.exchange, abi: exchangeAbi, functionName: "openOrders", args: [id, Side.Buy, 0n, 300n] },
      { address: d.exchange, abi: exchangeAbi, functionName: "openOrders", args: [id, Side.Sell, 0n, 300n] },
      { address: d.levelBook, abi: levelBookAbi, functionName: "free", args: [id, 1] },
      { address: d.levelBook, abi: levelBookAbi, functionName: "free", args: [id, 2] },
      { address: d.levelBook, abi: levelBookAbi, functionName: "free", args: [id, 3] },
      { address: d.levelBook, abi: levelBookAbi, functionName: "free", args: [id, 4] },
      { address: d.redemption, abi: redemptionEngineAbi, functionName: "openBatch", args: [id] },
      { address: token, abi: stockTokenAbi, functionName: "sharesPerToken" },
      { address: d.compliance, abi: complianceAbi, functionName: "tradingPaused", args: [id] },
      { address: d.compliance, abi: complianceAbi, functionName: "frozen", args: [id] },
    );
  }
  const ar = await mc(assetCalls);
  const per = assetCalls.length / ASSETS.length;
  const assets = [];
  for (let i = 0; i < ASSETS.length; i++) {
    const r = ar.slice(i * per, (i + 1) * per);
    const [supply, totalM, unbacked, reserve, hasPrice, stale, lastTrade, bids, asks, l1, l2, l3, l4, openBatch, spt, paused, frozen] = r;
    let close = 0n;
    let closeSession = 0;
    let asOf = 0;
    if (hasPrice) {
      const c = await publicClient.readContract({ address: d.priceOracle, abi: priceOracleAbi, functionName: "closeOf", args: [ASSETS[i].id] });
      close = c[0];
      closeSession = Number(c[1]);
      asOf = Number(c[2]);
    }
    const book = (x: any, side: number) =>
      (x[0] as bigint[]).map((id, k) => ({
        id: id.toString(),
        maker: x[1][k].maker,
        side,
        price: x[1][k].price.toString(),
        remaining: x[1][k].remaining.toString(),
        expiry: Number(x[1][k].expiry),
      }));
    const bidList = book(bids, Side.Buy).sort((a, b) => Number(BigInt(b.price) - BigInt(a.price)));
    const askList = book(asks, Side.Sell).sort((a, b) => Number(BigInt(a.price) - BigInt(b.price)));
    let batch = null;
    if (openBatch > 0n) {
      const b = await publicClient.readContract({ address: d.redemption, abi: redemptionEngineAbi, functionName: "batchOf", args: [openBatch] });
      batch = { id: openBatch.toString(), session: Number(b.session), units: b.units.toString() };
    }
    assets.push({
      ...ASSETS[i],
      token: d.tokens[i],
      supply: supply.toString(),
      totalM: totalM.toString(),
      unbacked: unbacked.toString(),
      reserve: { units: reserve[0].toString(), free: reserve[1].toString(), cash: reserve[2].toString() },
      close: close.toString(),
      closeSession,
      asOf,
      stale,
      lastTradePrice: lastTrade.toString(),
      bids: bidList,
      asks: askList,
      levels: { drain: l1.toString(), volunteer: l2.toString(), atRisk: l3.toString(), normal: l4.toString() },
      batch,
      sharesPerToken: spt.toString(),
      paused,
      frozen,
    });
  }

  // ---------------------------------------------------------------- brokers
  const list = (await publicClient.readContract({ address: d.brokers, abi: brokerRegistryAbi, functionName: "brokers" })) as Address[];
  const bcalls: Call[] = list.flatMap((b) => [
    { address: d.brokers, abi: brokerRegistryAbi, functionName: "brokerOf", args: [b] },
    { address: d.brokers, abi: brokerRegistryAbi, functionName: "nameOf", args: [b] },
    { address: d.bondVault, abi: bondVaultAbi, functionName: "bondOf", args: [b] },
    { address: d.brokers, abi: brokerRegistryAbi, functionName: "exposureValue", args: [b] },
    { address: d.brokers, abi: brokerRegistryAbi, functionName: "capacityValue", args: [b] },
    { address: d.brokers, abi: brokerRegistryAbi, functionName: "requiredBond", args: [b] },
    { address: d.brokers, abi: brokerRegistryAbi, functionName: "health", args: [b] },
    { address: d.pledges, abi: pledgeRegistryAbi, functionName: "pledgeCountByBroker", args: [b] },
  ]);
  const br = await mc(bcalls);
  const profiles = new Map(
    (db.prepare("SELECT wallet, bo_id FROM broker_profiles").all() as { wallet: string; bo_id: string }[]).map((p) => [p.wallet, p.bo_id]),
  );
  const brokers = list.map((b, i) => {
    const [info, name, bond, exposure, capacity, required, health, pledgeCount] = br.slice(i * 8, i * 8 + 8);
    return {
      address: b,
      name,
      tier: Number(info.tier),
      status: Number(info.status),
      delegate: info.delegate,
      healthLowSince: Number(info.healthLowSince),
      bond: bond.toString(),
      exposure: exposure.toString(),
      capacity: capacity.toString(),
      required: required.toString(),
      health: health > 10n ** 12n ? null : health.toString(),
      pledgeCount: Number(pledgeCount),
      boId: profiles.get(b.toLowerCase()) ?? null,
    };
  });

  // ---------------------------------------------------------------- pledges (all; bounded)
  const pledgeCount = Number(await publicClient.readContract({ address: d.pledges, abi: pledgeRegistryAbi, functionName: "count" }));
  const ids = Array.from({ length: Math.min(pledgeCount, 400) }, (_, i) => BigInt(pledgeCount - i));
  const pr = await mc(ids.flatMap((id) => [
    { address: d.pledges, abi: pledgeRegistryAbi, functionName: "pledgeOf", args: [id] },
    { address: d.levelBook, abi: levelBookAbi, functionName: "levelOf", args: [id] },
  ]));
  const pledges = ids.map((id, i) => {
    const p = pr[i * 2];
    const lv = pr[i * 2 + 1];
    return {
      id: id.toString(),
      minter: p.minter,
      broker: p.broker,
      assetId: Number(p.assetId),
      tier: Number(p.tier),
      status: Number(p.status),
      volunteer: p.volunteer,
      guided: p.guided,
      openedAt: Number(p.openedAt),
      attestedUntil: Number(p.attestedUntil),
      releaseDeadline: Number(p.releaseDeadline),
      releasePenaltyPaid: p.releasePenaltyPaid,
      q: p.q.toString(),
      m: p.m.toString(),
      a: p.a.toString(),
      pendingRelease: p.pendingRelease.toString(),
      invoked: p.invoked.toString(),
      cured: p.cured.toString(),
      released: p.released.toString(),
      bondSettled: p.bondSettled.toString(),
      level: Number(lv[0]),
      inQueue: lv[1],
    };
  });

  // ---------------------------------------------------------------- user
  let user = null;
  if (wallet && isAddress(wallet) && wallet !== zeroAddress) {
    const ucalls: Call[] = [
      { address: d.roles, abi: roleRegistryAbi, functionName: "roleOf", args: [wallet] },
      { address: d.usdc, abi: mockUsdcAbi, functionName: "balanceOf", args: [wallet] },
      { address: d.redemption, abi: redemptionEngineAbi, functionName: "ticketsOf", args: [wallet] },
      { address: d.exchange, abi: exchangeAbi, functionName: "ordersOf", args: [wallet] },
      ...d.tokens.map((t) => ({ address: t, abi: stockTokenAbi, functionName: "balanceOf", args: [wallet] })),
    ];
    const [role, usdc, ticketIds, orderIds, ...balances] = await mc(ucalls);
    user = {
      address: wallet,
      role: Number(role),
      usdc: usdc.toString(),
      balances: Object.fromEntries(ASSETS.map((a, i) => [a.id, balances[i].toString()])),
      tickets: await readTickets(ticketIds as bigint[]),
      orders: await readOrders(orderIds as bigint[]),
      // allocations this wallet must act on: as the minter of the pledge (cure) or the broker (settle)
      duties: await readDuties(wallet),
    };
  }

  return jsonSafe({
    chainId: d.chainId,
    block: Number(block.number),
    time: Number(block.timestamp),
    calendar: { mode: d.calendarMode, open: isOpen, extendedClosure: ext, count: total, lastClosed: found ? lastIdx : null, current, next, sessions },
    params,
    assets,
    brokers,
    pledges,
    user,
  });
}

async function readTickets(ids: bigint[]) {
  const d = deployment();
  const recent = ids.slice(-50).reverse();
  const tr = await mc(recent.flatMap((id) => [
    { address: d.redemption, abi: redemptionEngineAbi, functionName: "ticketOf", args: [id] },
    { address: d.redemption, abi: redemptionEngineAbi, functionName: "ticketAllocations", args: [id] },
  ]));
  const out = [];
  for (let i = 0; i < recent.length; i++) {
    const t = tr[i * 2];
    let allocIds = tr[i * 2 + 1] as bigint[];
    // small tickets: show the batch's aggregate allocations
    let batch = null;
    if (Number(t.cls) === 0 && t.batchId > 0n) {
      const b = await publicClient.readContract({ address: d.redemption, abi: redemptionEngineAbi, functionName: "batchOf", args: [t.batchId] });
      batch = { id: t.batchId.toString(), session: Number(b.session), processed: b.processed, units: b.units.toString(), aggTicket: b.aggTicket.toString() };
      if (b.processed) {
        allocIds = (await publicClient.readContract({ address: d.redemption, abi: redemptionEngineAbi, functionName: "ticketAllocations", args: [b.aggTicket] })) as bigint[];
      }
    }
    out.push({
      id: recent[i].toString(),
      assetId: Number(t.assetId),
      cls: Number(t.cls),
      status: Number(t.status),
      units: t.units.toString(),
      remaining: t.remaining.toString(),
      paid: t.paid.toString(),
      requestedAt: Number(t.requestedAt),
      openAllocs: Number(t.openAllocs),
      batch,
      allocations: await readAllocations(allocIds, Number(t.assetId)),
    });
  }
  return out;
}

async function readAllocations(ids: bigint[], assetId?: number) {
  const d = deployment();
  if (!ids.length) return [];
  const ar = await mc(ids.map((id) => ({ address: d.redemption, abi: redemptionEngineAbi, functionName: "allocationOf", args: [id] })));
  const tickets = assetId === undefined
    ? await mc(ar.map((a: any) => ({ address: d.redemption, abi: redemptionEngineAbi, functionName: "ticketOf", args: [a.ticketId] })))
    : [];
  const refs = await mc(ar.map((a: any, i: number) => ({
    address: d.priceOracle,
    abi: priceOracleAbi,
    functionName: "closeAt",
    args: [assetId ?? Number(tickets[i].assetId), a.refSession],
  })));
  return ar.map((a: any, i: number) => ({
    id: ids[i].toString(),
    ticketId: a.ticketId.toString(),
    assetId: assetId ?? Number(tickets[i].assetId),
    holder: assetId === undefined ? tickets[i].holder : undefined,
    pledgeId: a.pledgeId.toString(),
    units: a.units.toString(),
    status: Number(a.status),
    volunteer: a.volunteer,
    refSession: Number(a.refSession),
    softSession: Number(a.softSession),
    hardSession: Number(a.hardSession),
    cureDeadline: Number(a.cureDeadline),
    softDeadline: Number(a.softDeadline),
    hardDeadline: Number(a.hardDeadline),
    cureEscrow: a.cureEscrow.toString(),
    paid: a.paid.toString(),
    refClose: refs[i].toString(),
  }));
}

async function readOrders(ids: bigint[]) {
  const d = deployment();
  const recent = ids.slice(-60).reverse();
  const or = await mc(recent.map((id) => ({ address: d.exchange, abi: exchangeAbi, functionName: "getOrder", args: [id] })));
  return or.map((o: any, i: number) => ({
    id: recent[i].toString(),
    assetId: Number(o.assetId),
    side: Number(o.side),
    status: Number(o.status),
    price: o.price.toString(),
    amount: o.amount.toString(),
    remaining: o.remaining.toString(),
    usdcEscrow: o.usdcEscrow.toString(),
    createdAt: Number(o.createdAt),
    expiry: Number(o.expiry),
  }));
}

/** Allocations on pledges where this wallet is the minter or the broker, from the event index. */
async function readDuties(wallet: Address) {
  const w = wallet.toLowerCase();
  const rows = db
    .prepare("SELECT args FROM events WHERE name = 'AllocationCreated' ORDER BY block DESC LIMIT 2000")
    .all() as { args: string }[];
  const ids: bigint[] = [];
  for (const r of rows) {
    const a = JSON.parse(r.args);
    if (String(a.minter).toLowerCase() === w || String(a.broker).toLowerCase() === w) ids.push(BigInt(a.allocId));
  }
  return readAllocations(ids.slice(0, 100));
}

snapshot.get("/", async (c) => {
  const w = c.req.query("wallet");
  return c.json(await buildSnapshot(w && isAddress(w) ? (w as Address) : undefined));
});
