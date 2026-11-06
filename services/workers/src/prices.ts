/**
 * Market data. NSE prices come from Twelve Data first (TWELVEDATA_API_KEY, exchange NSE) and Yahoo Finance's
 * chart endpoint as the fallback. USD/INR is the median of Frankfurter (ECB), open.er-api and Yahoo. Only
 * programmatic endpoints are used; no scraping. Quotes are cached for a minute to respect rate limits.
 */
import { ASSETS } from "@bullstreet/shared";
import { log } from "./ctx";

async function getJson(url: string, timeoutMs = 8000): Promise<any | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

const num = (x: unknown) => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export interface Quote {
  price: number; // INR, latest trade (close once the session has ended)
  source: "twelvedata" | "yahoo";
}

export async function twelveData(ticker: string): Promise<Quote | undefined> {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) return undefined;
  const j = await getJson(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(ticker)}&exchange=NSE&apikey=${key}`);
  if (!j || j.status === "error") return undefined;
  const price = num(j.close);
  return price ? { price, source: "twelvedata" } : undefined;
}

export async function yahoo(symbol: string): Promise<Quote | undefined> {
  const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`);
  const price = num(j?.chart?.result?.[0]?.meta?.regularMarketPrice);
  return price ? { price, source: "yahoo" } : undefined;
}

export async function usdInr(): Promise<number | undefined> {
  const rates = (
    await Promise.all([
      getJson("https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR").then((j) => num(j?.rates?.INR)),
      getJson("https://open.er-api.com/v6/latest/USD").then((j) => num(j?.rates?.INR)),
      yahoo("INR=X").then((q) => q?.price),
    ])
  ).filter((x): x is number => x !== undefined);
  if (!rates.length) return undefined;
  rates.sort((a, b) => a - b);
  return rates[Math.floor(rates.length / 2)];
}

const cache = new Map<string, { at: number; v: Quote }>();

export async function quote(ticker: string, yahooSymbol: string): Promise<Quote | undefined> {
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  const q = (await twelveData(ticker)) ?? (await yahoo(yahooSymbol));
  if (q) cache.set(ticker, { at: Date.now(), v: q });
  return q;
}

/** USDC per share (6 decimals) for every asset, or undefined where no source answered. */
export async function usdcPrices(): Promise<Map<number, bigint>> {
  const fx = await usdInr();
  const out = new Map<number, bigint>();
  if (!fx) {
    log("prices", "no USD/INR rate from any source");
    return out;
  }
  for (const a of ASSETS) {
    const q = await quote(a.ticker, a.yahoo);
    if (!q) {
      log("prices", `no quote for ${a.ticker}`);
      continue;
    }
    out.set(a.id, BigInt(Math.round((q.price / fx) * 1e6)));
    log("prices", `${a.ticker} ₹${q.price.toFixed(2)} / ${fx.toFixed(3)} = $${(q.price / fx).toFixed(4)} (${q.source})`);
  }
  return out;
}
