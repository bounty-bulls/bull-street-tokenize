import { Hono } from "hono";
import type { Address } from "viem";
import {
  BrokerStatus,
  Level,
  bondVaultAbi,
  brokerRegistryAbi,
  levelBookAbi,
  paramsAbi,
  pledgeRegistryAbi,
  priceOracleAbi,
  redemptionEngineAbi,
  paramKey as stringToParamKey,
} from "@bullstreet/shared";
import { deployment, publicClient } from "../ctx";

/**
 * Off-chain planners (E2). The pledge planner splits a holding into shards that fit the broker tiers and
 * spreads them across the least-utilised healthy brokers. The allocation planner simulates the on-chain
 * dispatcher so the app can preview where a redemption will be served from; its output is only a hint.
 */
export const plan = new Hono();

const read = (address: Address, abi: any, functionName: string, args: readonly unknown[] = []) =>
  publicClient.readContract({ address, abi, functionName, args } as any) as Promise<any>;

plan.post("/pledge", async (c) => {
  const { assetId, shares } = (await c.req.json()) as { assetId: number; shares: number };
  if (!Number.isInteger(shares) || shares <= 0) return c.json({ error: "Enter a whole number of shares" }, 400);
  const d = deployment();
  const [close] = (await read(d.priceOracle, priceOracleAbi, "closeOf", [assetId])) as [bigint];
  const p = Number(close) / 1e6;
  const caps = await Promise.all(
    ["TIER_CAP_1", "TIER_CAP_2", "TIER_CAP_3"].map(async (k) => Number(await read(d.params, paramsAbi, "get", [stringToParamKey(k)])) / 1e6),
  );
  const list = (await read(d.brokers, brokerRegistryAbi, "brokers")) as Address[];
  const brokers = [];
  for (const b of list) {
    const info = await read(d.brokers, brokerRegistryAbi, "brokerOf", [b]);
    if (Number(info.status) !== BrokerStatus.Active) continue;
    const health = (await read(d.brokers, brokerRegistryAbi, "health", [b])) as bigint;
    if (health < 12_000n) continue;
    brokers.push({
      address: b,
      name: (await read(d.brokers, brokerRegistryAbi, "nameOf", [b])) as string,
      tier: Number(info.tier),
      exposure: Number(await read(d.brokers, brokerRegistryAbi, "exposureValue", [b])) / 1e6,
      capacity: Number(await read(d.brokers, brokerRegistryAbi, "capacityValue", [b])) / 1e6,
      planned: 0,
    });
  }

  const shards: { broker: Address; name: string; tier: number; shares: number; value: number }[] = [];
  let remaining = shares;
  const big = shares * p > caps[1];
  const halfCap = Math.ceil(shares / 2);
  while (remaining > 0) {
    let best: { b: (typeof brokers)[number]; x: number; util: number } | undefined;
    for (const b of brokers) {
      const cap = caps[b.tier];
      const minValue = b.tier === 0 ? 0 : caps[b.tier - 1];
      const avail = Math.min(cap, b.capacity - b.exposure - b.planned);
      let x = Math.min(remaining, Math.floor(avail / p));
      if (big) x = Math.min(x, halfCap);
      if (x <= 0 || x * p <= minValue) continue; // the shard must fall in this broker's tier
      const util = (b.exposure + b.planned) / Math.max(b.capacity, 1);
      if (!best || x > best.x || (x === best.x && util < best.util)) best = { b, x, util };
    }
    if (!best) {
      return c.json({ error: "No broker has enough capacity in the right tier for this pledge", shards, unplaced: remaining }, 409);
    }
    best.b.planned += best.x * p;
    shards.push({ broker: best.b.address, name: best.b.name, tier: best.b.tier, shares: best.x, value: best.x * p });
    remaining -= best.x;
  }
  return c.json({ price: p, shards });
});

/** Simulates RedemptionEngine._allocate: reserve first, then L1..L4, best fit, distinct brokers first. */
plan.post("/allocation", async (c) => {
  const { assetId, shares } = (await c.req.json()) as { assetId: number; shares: number };
  const d = deployment();
  const maxAllocs = Number(await read(d.params, paramsAbi, "get", [stringToParamKey("MAX_ALLOCS")]));
  let need = BigInt(shares) * 10n ** 18n;
  const steps: { level: number; pledgeId: string; broker?: Address; units: string }[] = [];
  const [, reserveFree] = (await read(d.redemption, redemptionEngineAbi, "reserveOf", [assetId])) as bigint[];
  if (reserveFree > 0n && need > 0n) {
    const x = need < reserveFree ? need : reserveFree;
    steps.push({ level: Level.Reserve, pledgeId: "0", units: x.toString() });
    need -= x;
  }
  const hint: string[] = [];
  for (const level of [Level.Drain, Level.Volunteer, Level.AtRisk, Level.Normal]) {
    if (need === 0n) break;
    const members = (await read(d.levelBook, levelBookAbi, "members", [assetId, level])) as bigint[];
    const cands = [];
    for (const id of members.slice(0, 50)) {
      const [broker, minter, f] = await read(d.pledges, pledgeRegistryAbi, "routeInfo", [id]);
      const status = Number((await read(d.brokers, brokerRegistryAbi, "statusOf", [broker])) as number);
      const bond = (await read(d.bondVault, bondVaultAbi, "bondOf", [broker])) as bigint;
      if (status === BrokerStatus.Defaulted && bond === 0n) continue;
      const lru = BigInt(await read(d.pledges, pledgeRegistryAbi, "lastInvokedAt", [minter]));
      cands.push({ id, broker: broker as Address, f: f as bigint, lru });
    }
    const used = new Set<string>();
    while (need > 0n && steps.length < maxAllocs) {
      const pool = cands.filter((x) => x.f > 0n);
      if (!pool.length) break;
      const fresh = pool.filter((x) => !used.has(x.broker));
      const scan = fresh.length ? fresh : pool;
      scan.sort((a, b) => {
        const af = a.f >= need;
        const bf = b.f >= need;
        if (af !== bf) return af ? -1 : 1;
        if (a.f !== b.f) return af ? (a.f < b.f ? -1 : 1) : a.f > b.f ? -1 : 1;
        if (a.lru !== b.lru) return a.lru < b.lru ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
      const pick = scan[0];
      const x = need < pick.f ? need : pick.f;
      pick.f -= x;
      need -= x;
      used.add(pick.broker);
      steps.push({ level, pledgeId: pick.id.toString(), broker: pick.broker, units: x.toString() });
      hint.push(pick.id.toString());
    }
  }
  return c.json({ steps, unplaced: need.toString(), hint });
});
