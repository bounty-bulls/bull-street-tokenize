import { formatUnits, parseUnits, stringToHex } from "viem";

/** USDC has 6 decimals; tokens have 18. */
export const USDC_DECIMALS = 6;
export const TOKEN_DECIMALS = 18;
export const ONE_TOKEN = 10n ** 18n;

export const usd6 = (x: number | string) => parseUnits(String(x), USDC_DECIMALS);
export const tokens = (x: number | string) => parseUnits(String(x), TOKEN_DECIMALS);

export function formatUsd6(v: bigint, dp = 2): string {
  const n = Number(formatUnits(v, USDC_DECIMALS));
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function formatTokens(v: bigint, dp = 2): string {
  const n = Number(formatUnits(v, TOKEN_DECIMALS));
  return n.toLocaleString("en-US", { maximumFractionDigits: dp });
}

/** USDC (6dp) value of `units` tokens at `price` USDC per token. */
export const valueOf = (units: bigint, price: bigint) => (units * price) / ONE_TOKEN;

export const bps = (v: bigint | number) => `${(Number(v) / 100).toFixed(2)}%`;

export function shortAddr(a?: string): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

/** Params keys are bytes32 string literals in Solidity ("TIER_CAP_1" left-aligned, zero padded). */
export const paramKey = (k: string) => stringToHex(k, { size: 32 });
