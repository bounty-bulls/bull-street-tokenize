import type { AssetView, PledgeView } from "./types";

/** Market price from the order book: midpoint of the best bid and ask, else the last trade, else none. */
export function marketPrice(a: AssetView): bigint | undefined {
  const bid = a.bids[0] ? BigInt(a.bids[0].price) : undefined;
  const ask = a.asks[0] ? BigInt(a.asks[0].price) : undefined;
  if (bid !== undefined && ask !== undefined) return (bid + ask) / 2n;
  const last = BigInt(a.lastTradePrice);
  if (last > 0n) return last;
  return bid ?? ask;
}

export function premiumPct(price?: bigint, close?: string | bigint): number | undefined {
  const c = BigInt(close ?? 0);
  if (!price || c === 0n) return undefined;
  return Math.round((Number(price) / Number(c) - 1) * 10_000) / 100;
}

/** Shares pledged behind live pledges of an asset (token units). */
export function pledgedUnits(assetId: number, pledges: PledgeView[]): bigint {
  return pledges.filter((p) => p.assetId === assetId && p.status === 2).reduce((s, p) => s + BigInt(p.q), 0n);
}

export const sumBig = (xs: (string | bigint)[]) => xs.reduce<bigint>((s, x) => s + BigInt(x), 0n);
