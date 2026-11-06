import { Hono } from "hono";
import { isAddress, keccak256, toHex, verifyMessage, type Address, type Hex } from "viem";
import { brokerRegistryAbi, pledgeRegistryAbi, assetById } from "@bullstreet/shared";
import { now } from "@bullstreet/shared/db";
import {
  DepositoryError,
  accountsByWallet,
  agreementFor,
  createAccount,
  accept,
  getAccount,
  getPledge,
  invoke,
  release,
  guidedInstructions,
  inboxOf,
  pledgeByAgreement,
  pledgesFor,
  reportGuided,
  setupPledge,
} from "@bullstreet/shared/depository";
import { ALLOW_DEV_IDENTITY, businessTiming, db, deployment, publicClient } from "../ctx";

/**
 * Depository endpoints. The connected ledger follows CDSL normal-pledge rules; the guided mode records a pledge
 * the owner made in CDSL Easiest. Pledgee-side actions (accept, invoke, release) are performed by brokers'
 * agents against the same store, not over HTTP.
 */
export const dep = new Hono();

const guard = (fn: (c: any) => Promise<Response> | Response) => async (c: any) => {
  try {
    return await fn(c);
  } catch (e) {
    if (e instanceof DepositoryError) return c.json({ error: e.message }, 400);
    throw e;
  }
};

const DEFAULT_HOLDINGS: Record<string, number> = { INE002A01018: 400, INE467B01029: 120, INE009A01021: 300 };

/** Link a demat account to a wallet. A new account starts with the connected broker's holdings snapshot. */
dep.post(
  "/accounts",
  guard(async (c) => {
    const { boId, wallet, name } = await c.req.json();
    if (!isAddress(wallet)) return c.json({ error: "Bad wallet" }, 400);
    const existing = getAccount(db, boId);
    if (existing?.account.owner_wallet && existing.account.owner_wallet !== wallet.toLowerCase()) {
      return c.json({ error: "This BO ID is linked to another wallet" }, 409);
    }
    const acc = createAccount(db, {
      boId,
      ownerWallet: wallet,
      name: name || "Demat account",
      holdings: existing ? undefined : DEFAULT_HOLDINGS,
    });
    return c.json(getAccount(db, acc.bo_id));
  }),
);

dep.get("/accounts/:boId", (c) => {
  const a = getAccount(db, c.req.param("boId"));
  return a ? c.json(a) : c.json({ error: "Unknown BO ID" }, 404);
});

dep.get("/wallet/:wallet", (c) => {
  const accounts = accountsByWallet(db, c.req.param("wallet"));
  return c.json(accounts.map((a) => getAccount(db, a.bo_id)));
});

dep.get("/pledges", (c) => c.json(pledgesFor(db, { pledgee: c.req.query("pledgee"), pledgor: c.req.query("pledgor") })));
dep.get("/pledges/:psn", (c) => {
  const p = getPledge(db, c.req.param("psn"));
  return p ? c.json(p) : c.json({ error: "Unknown PSN" }, 404);
});
dep.get("/agreement/:pledgeId", (c) => {
  const p = pledgeByAgreement(db, agreementFor(BigInt(c.req.param("pledgeId"))));
  return p ? c.json(p) : c.json({ error: "No depository pledge for this agreement yet" }, 404);
});
dep.get("/inbox/:boId", (c) => c.json(inboxOf(db, c.req.param("boId"))));

/** Broker BO IDs are stored hashed on-chain; brokers publish theirs here so minters can pledge to them. */
dep.post(
  "/brokers",
  guard(async (c) => {
    const { wallet, boId, name } = await c.req.json();
    if (!isAddress(wallet) || !/^\d{16}$/.test(boId)) return c.json({ error: "Bad input" }, 400);
    const b = await publicClient.readContract({ address: deployment().brokers, abi: brokerRegistryAbi, functionName: "brokerOf", args: [wallet as Address] });
    if (b.boIdHash !== keccak256(toHex(boId))) return c.json({ error: "BO ID does not match the hash registered on-chain" }, 400);
    db.prepare(
      "INSERT INTO broker_profiles(wallet, bo_id, name, created_at) VALUES(?, ?, ?, ?) ON CONFLICT(wallet) DO UPDATE SET bo_id = excluded.bo_id, name = excluded.name",
    ).run(wallet.toLowerCase(), boId, name || "Broker", now());
    // brokers' pledgee accounts auto-accept (standing instruction)
    createAccount(db, { boId, ownerWallet: wallet, name: name || "Broker", standingAutoAccept: true });
    return c.json({ ok: true });
  }),
);

dep.get("/brokers", (c) => c.json(db.prepare("SELECT * FROM broker_profiles").all()));

async function chainPledge(pledgeId: bigint) {
  return publicClient.readContract({ address: deployment().pledges, abi: pledgeRegistryAbi, functionName: "pledgeOf", args: [pledgeId] });
}

function brokerBoId(wallet: string): string | undefined {
  return (db.prepare("SELECT bo_id FROM broker_profiles WHERE wallet = ?").get(wallet.toLowerCase()) as { bo_id: string } | undefined)?.bo_id;
}

/** Connected account: create the depository pledge for an on-chain pledge the minter just opened. */
dep.post(
  "/pledge",
  guard(async (c) => {
    const { pledgeId, boId } = await c.req.json();
    const id = BigInt(pledgeId);
    const p = await chainPledge(id);
    const acc = getAccount(db, boId);
    if (!acc || acc.account.owner_wallet !== p.minter.toLowerCase()) return c.json({ error: "This demat account is not linked to the pledge's minter" }, 403);
    const pledgee = brokerBoId(p.broker);
    if (!pledgee) return c.json({ error: "The broker has not published its BO ID" }, 400);
    const asset = assetById(p.assetId)!;
    const shares = Number(p.q / 10n ** 18n);
    const timing = await businessTiming();
    const today = new Date().toISOString().slice(0, 10);
    const pledge = setupPledge(
      db,
      { pledgorBoId: boId, pledgeeBoId: pledgee, isin: asset.isin, qty: shares, agreementNo: agreementFor(id), execDate: today },
      timing,
    );
    return c.json(pledge);
  }),
);

/** Guided mode: the computed CDSL Easiest values for an on-chain pledge. */
dep.get(
  "/guided/:pledgeId",
  guard(async (c) => {
    const id = BigInt(c.req.param("pledgeId"));
    const p = await chainPledge(id);
    const pledgee = brokerBoId(p.broker);
    if (!pledgee) return c.json({ error: "The broker has not published its BO ID" }, 400);
    const asset = assetById(p.assetId)!;
    const closure = new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10);
    return c.json({
      pledgeeBoId: pledgee,
      isin: asset.isin,
      qty: Number(p.q / 10n ** 18n),
      agreementNo: agreementFor(id),
      closureDate: closure,
      ...guidedInstructions({ pledgeeBoId: pledgee, isin: asset.isin, qty: Number(p.q / 10n ** 18n), agreementNo: agreementFor(id), closureDate: closure }),
    });
  }),
);

dep.post(
  "/guided/:pledgeId",
  guard(async (c) => {
    const id = BigInt(c.req.param("pledgeId"));
    const { boId, psn } = await c.req.json();
    const p = await chainPledge(id);
    const pledgee = brokerBoId(p.broker);
    if (!pledgee) return c.json({ error: "The broker has not published its BO ID" }, 400);
    const asset = assetById(p.assetId)!;
    const pledge = reportGuided(db, {
      pledgorBoId: boId,
      pledgeeBoId: pledgee,
      isin: asset.isin,
      qty: Number(p.q / 10n ** 18n),
      agreementNo: agreementFor(id),
      psn,
      execDate: new Date().toISOString().slice(0, 10),
    });
    return c.json(pledge);
  }),
);

/** Seeding helper for local chains: create an account with explicit holdings. */
dep.post(
  "/seed-account",
  guard(async (c) => {
    if (!ALLOW_DEV_IDENTITY) return c.json({ error: "Not available" }, 404);
    const body = await c.req.json();
    return c.json(createAccount(db, body));
  }),
);

/** The message a pledgee signs to act on its own depository account (prevents anyone acting for it). */
export const depMessage = (action: string, psn: string, qty: number, ts: number) =>
  `Bull Street depository\naction: ${action}\npsn: ${psn}\nqty: ${qty}\ntime: ${ts}`;

async function pledgeeAuth(c: any, action: string) {
  const psn = c.req.param("psn");
  const { wallet, qty = 0, ts, sig } = (await c.req.json()) as { wallet: Address; qty?: number; ts: number; sig?: Hex };
  const p = getPledge(db, psn);
  if (!p) return { error: c.json({ error: "Unknown PSN" }, 404) };
  const owner = getAccount(db, p.pledgee)?.account.owner_wallet;
  if (!owner || owner !== String(wallet).toLowerCase()) return { error: c.json({ error: "Only the pledgee can do this" }, 403) };
  if (!ALLOW_DEV_IDENTITY) {
    if (!sig || Math.abs(Date.now() / 1000 - ts) > 300) return { error: c.json({ error: "Signature required" }, 401) };
    const ok = await verifyMessage({ address: wallet, message: depMessage(action, psn, qty, ts), signature: sig });
    if (!ok) return { error: c.json({ error: "Bad signature" }, 401) };
  }
  return { psn, qty: Number(qty) };
}

/** Pledgee confirms a pledge it can see in its CDSL account (guided pledges, or manual acceptance). */
dep.post(
  "/pledges/:psn/confirm",
  guard(async (c) => {
    const r = await pledgeeAuth(c, "confirm");
    if ("error" in r) return r.error;
    return c.json(accept(db, r.psn));
  }),
);

/** Pledgee invokes shares to sell them for a redemption. */
dep.post(
  "/pledges/:psn/invoke",
  guard(async (c) => {
    const r = await pledgeeAuth(c, "invoke");
    if ("error" in r) return r.error;
    return c.json(invoke(db, r.psn, r.qty));
  }),
);

/** Pledgee unpledges shares the minter asked to release. */
dep.post(
  "/pledges/:psn/release",
  guard(async (c) => {
    const r = await pledgeeAuth(c, "release");
    if ("error" in r) return r.error;
    return c.json(release(db, r.psn, r.qty));
  }),
);
