import { ASSETS, domain, nextSessions, priceBatchTypes, priceOracleAbi, randomNonce, sessionBatchTypes, sessionClockAbi, type Session } from "@bullstreet/shared";
import type { Hex } from "viem";
import { CHAIN_ID, d, errMsg, log, nowSec, oracleSigners, read, send, syncClock } from "./ctx";
import { usdcPrices } from "./prices";

const AHEAD = 24;

/** Signatures from the first `threshold` signers, ordered by ascending address (as the contract requires). */
async function thresholdSign(sign: (acc: ReturnType<typeof oracleSigners>[number]) => Promise<Hex>): Promise<Hex[]> {
  const signers = oracleSigners().sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1));
  const threshold = Number(d.oracleThreshold ?? 2);
  return Promise.all(signers.slice(0, threshold).map(sign));
}

/** Keeps at least AHEAD future sessions posted. */
export async function postSessions(): Promise<void> {
  const count = Number(await read<bigint>(d.sessionClock, sessionClockAbi, "count"));
  let last: Session | undefined;
  let future = 0;
  if (count > 0) {
    const [open, close] = await read<[bigint, bigint]>(d.sessionClock, sessionClockAbi, "sessionAt", [BigInt(count - 1)]);
    last = { index: count - 1, open: Number(open), close: Number(close) };
    const next = Number(await read<number>(d.sessionClock, sessionClockAbi, "nextSessionIndex").catch(() => count));
    future = count - next;
  }
  if (future >= AHEAD) return;
  const sessions = nextSessions(d.calendarMode, last, AHEAD - future + (last ? 0 : 1), nowSec());
  const nonce = randomNonce();
  const msg = {
    sessions: sessions.map((s) => ({ sessionIndex: s.index, openTime: BigInt(s.open), closeTime: BigInt(s.close) })),
    nonce,
  };
  const sigs = await thresholdSign((acc) =>
    acc.signTypedData({ domain: domain(CHAIN_ID, d.sessionClock), types: sessionBatchTypes, primaryType: "SessionBatch", message: msg }),
  );
  await send(oracleSigners()[0], d.sessionClock, sessionClockAbi, "postSessions", [
    msg.sessions,
    nonce,
    sigs,
  ]);
  log("oracle", `posted sessions ${sessions[0].index}..${sessions[sessions.length - 1].index}`);
}

let lastGood = new Map<number, bigint>();

/** After a session closes, posts every asset's close for it. Falls back to the last good price per asset. */
export async function postPrices(): Promise<void> {
  const [found, last] = await read<[boolean, number]>(d.sessionClock, sessionClockAbi, "lastClosedSession");
  if (!found) return;
  const due: number[] = [];
  for (const a of ASSETS) {
    const has = await read<boolean>(d.priceOracle, priceOracleAbi, "hasPrice", [a.id]);
    if (!has) {
      due.push(a.id);
      continue;
    }
    const [close, session] = await read<[bigint, number, bigint]>(d.priceOracle, priceOracleAbi, "closeOf", [a.id]);
    if (!lastGood.has(a.id)) lastGood.set(a.id, close);
    if (Number(session) < Number(last)) due.push(a.id);
  }
  if (!due.length) return;

  const fresh = await usdcPrices();
  const ids: number[] = [];
  const closes: bigint[] = [];
  for (const id of due) {
    const p = fresh.get(id) ?? lastGood.get(id);
    if (!p) continue;
    ids.push(id);
    closes.push(p);
    lastGood.set(id, p);
  }
  if (!ids.length) return;
  const nonce = randomNonce();
  const asOf = BigInt(nowSec());
  const message = { sessionIndex: Number(last), assetIds: ids, closes, asOf, nonce };
  const sigs = await thresholdSign((acc) =>
    acc.signTypedData({ domain: domain(CHAIN_ID, d.priceOracle), types: priceBatchTypes, primaryType: "PriceBatch", message }),
  );
  await send(oracleSigners()[0], d.priceOracle, priceOracleAbi, "postBatch", [Number(last), ids, closes, asOf, nonce, sigs]);
  log("oracle", `posted closes for session ${last}: ${ids.map((id, i) => `${id}=${Number(closes[i]) / 1e6}`).join(" ")}`);
}

export async function oracleTick(): Promise<void> {
  await syncClock();
  try {
    await postSessions();
  } catch (e) {
    log("oracle", `sessions failed: ${errMsg(e)}`);
  }
  try {
    await postPrices();
  } catch (e) {
    log("oracle", `prices failed: ${errMsg(e)}`);
  }
}
