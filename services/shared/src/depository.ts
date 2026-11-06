/**
 * Depository adapter. Two modes share one record format:
 *
 * - connected: a ledger that follows CDSL's normal-pledge rules (DP Operating Instructions ch. 8): both parties at
 *   CDSL, pledge only free balance, pledgee may auto-accept via a standing instruction, partial invocation and
 *   release, 15-day auto-reject, processing on business days only, alerts to both parties.
 * - guided: the owner pledges in CDSL Easiest themselves; we store the pledge sequence number (PSN) they report
 *   and the broker confirms it against their own account before attesting on-chain.
 *
 * Node only. Quantities are whole shares.
 */
import { addNotice, now, type DB } from "./db";

export type PledgeState = "SETUP" | "ACCEPTED" | "PARTIALLY_CLOSED" | "CLOSED" | "REJECTED" | "REPORTED";

export interface DepAccount {
  bo_id: string;
  owner_wallet: string | null;
  name: string;
  depository: string;
  standing_auto_accept: number;
}

export interface DepPledge {
  psn: string;
  pledgor: string;
  pledgee: string;
  isin: string;
  qty: number;
  invoked: number;
  released: number;
  status: PledgeState;
  agreement_no: string;
  exec_date: string;
  closure_date: string | null;
  guided: number;
  process_after: number;
  created_at: number;
  updated_at: number;
}

export class DepositoryError extends Error {}

const BO_ID = /^\d{16}$/;
const fail = (msg: string): never => {
  throw new DepositoryError(msg);
};

export const agreementFor = (pledgeId: bigint | number) => `BS-${pledgeId}`;

export function newPsn(): string {
  return `PSN${Math.floor(1e9 + Math.random() * 9e9)}`;
}

export function createAccount(
  db: DB,
  a: { boId: string; ownerWallet?: string; name: string; standingAutoAccept?: boolean; holdings?: Record<string, number> },
): DepAccount {
  if (!BO_ID.test(a.boId)) fail("A CDSL BO ID has 16 digits");
  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO dep_accounts(bo_id, owner_wallet, name, depository, standing_auto_accept, created_at) VALUES(?, ?, ?, 'CDSL', ?, ?) " +
        "ON CONFLICT(bo_id) DO UPDATE SET owner_wallet = COALESCE(excluded.owner_wallet, dep_accounts.owner_wallet), name = excluded.name, standing_auto_accept = excluded.standing_auto_accept",
    ).run(a.boId, a.ownerWallet?.toLowerCase() ?? null, a.name, a.standingAutoAccept ? 1 : 0, now());
    for (const [isin, qty] of Object.entries(a.holdings ?? {})) {
      db.prepare(
        "INSERT INTO dep_holdings(bo_id, isin, free) VALUES(?, ?, ?) ON CONFLICT(bo_id, isin) DO UPDATE SET free = excluded.free",
      ).run(a.boId, isin, qty);
    }
  });
  tx();
  return getAccount(db, a.boId)!.account;
}

export function getAccount(db: DB, boId: string) {
  const account = db.prepare("SELECT * FROM dep_accounts WHERE bo_id = ?").get(boId) as DepAccount | undefined;
  if (!account) return undefined;
  const holdings = db.prepare("SELECT isin, free, pledged, pledgee_balance FROM dep_holdings WHERE bo_id = ?").all(boId) as {
    isin: string;
    free: number;
    pledged: number;
    pledgee_balance: number;
  }[];
  const pledges = db
    .prepare("SELECT * FROM dep_pledges WHERE pledgor = ? OR pledgee = ? ORDER BY created_at DESC")
    .all(boId, boId) as DepPledge[];
  return { account, holdings, pledges };
}

export function accountsByWallet(db: DB, wallet: string): DepAccount[] {
  return db.prepare("SELECT * FROM dep_accounts WHERE owner_wallet = ?").all(wallet.toLowerCase()) as DepAccount[];
}

export function getPledge(db: DB, psn: string): DepPledge | undefined {
  return db.prepare("SELECT * FROM dep_pledges WHERE psn = ?").get(psn) as DepPledge | undefined;
}

export function pledgeByAgreement(db: DB, agreementNo: string): DepPledge | undefined {
  return db
    .prepare("SELECT * FROM dep_pledges WHERE agreement_no = ? AND status != 'REJECTED' ORDER BY created_at DESC")
    .get(agreementNo) as DepPledge | undefined;
}

export function pledgesFor(db: DB, q: { pledgee?: string; pledgor?: string }): DepPledge[] {
  if (q.pledgee) return db.prepare("SELECT * FROM dep_pledges WHERE pledgee = ? ORDER BY created_at DESC").all(q.pledgee) as DepPledge[];
  if (q.pledgor) return db.prepare("SELECT * FROM dep_pledges WHERE pledgor = ? ORDER BY created_at DESC").all(q.pledgor) as DepPledge[];
  return db.prepare("SELECT * FROM dep_pledges ORDER BY created_at DESC LIMIT 200").all() as DepPledge[];
}

export const remainingOf = (p: DepPledge) => p.qty - p.invoked - p.released;

function inbox(db: DB, boId: string, subject: string, body: string) {
  db.prepare("INSERT INTO dep_inbox(bo_id, ts, subject, body) VALUES(?, ?, ?, ?)").run(boId, now(), subject, body);
  const acc = db.prepare("SELECT owner_wallet FROM dep_accounts WHERE bo_id = ?").get(boId) as { owner_wallet: string | null } | undefined;
  if (acc?.owner_wallet) addNotice(db, { wallet: acc.owner_wallet, kind: "cdsl", title: subject, body });
}

export function inboxOf(db: DB, boId: string) {
  return db.prepare("SELECT * FROM dep_inbox WHERE bo_id = ? ORDER BY id DESC LIMIT 100").all(boId);
}

/**
 * Pledge setup by the pledgor (Easiest: Pledge > Pledgor > Pledge Setup). `businessOpen` is false on
 * weekends and holidays: the request then waits until `nextBusiness` before the pledgee's standing
 * instruction accepts it.
 */
export function setupPledge(
  db: DB,
  r: { pledgorBoId: string; pledgeeBoId: string; isin: string; qty: number; agreementNo: string; execDate: string; closureDate?: string },
  timing: { businessOpen: boolean; nextBusiness: number },
): DepPledge {
  const pledgor = getAccount(db, r.pledgorBoId) ?? fail("Unknown pledgor BO ID");
  const pledgee = getAccount(db, r.pledgeeBoId) ?? fail("Unknown pledgee BO ID");
  if (pledgor.account.depository !== "CDSL" || pledgee.account.depository !== "CDSL") fail("Both accounts must be at CDSL");
  if (r.pledgorBoId === r.pledgeeBoId) fail("Pledgor and pledgee must differ");
  if (!Number.isInteger(r.qty) || r.qty <= 0) fail("Quantity must be a whole number of shares");
  const h = pledgor.holdings.find((x) => x.isin === r.isin);
  if (!h || h.free < r.qty) fail("Quantity exceeds the free balance");
  if (pledgeByAgreement(db, r.agreementNo)) fail("A pledge with this agreement number already exists");

  const psn = newPsn();
  const t = now();
  db.transaction(() => {
    db.prepare("UPDATE dep_holdings SET free = free - ?, pledged = pledged + ? WHERE bo_id = ? AND isin = ?").run(r.qty, r.qty, r.pledgorBoId, r.isin);
    db.prepare(
      "INSERT INTO dep_pledges(psn, pledgor, pledgee, isin, qty, status, agreement_no, exec_date, closure_date, guided, process_after, created_at, updated_at) VALUES(?, ?, ?, ?, ?, 'SETUP', ?, ?, ?, 0, ?, ?, ?)",
    ).run(psn, r.pledgorBoId, r.pledgeeBoId, r.isin, r.qty, r.agreementNo, r.execDate, r.closureDate ?? null, timing.businessOpen ? 0 : timing.nextBusiness, t, t);
    inbox(db, r.pledgorBoId, `Pledge request ${psn} created`, `${r.qty} shares of ${r.isin} pledged to ${r.pledgeeBoId} (agreement ${r.agreementNo}).`);
    inbox(db, r.pledgeeBoId, `Pledge request ${psn} received`, `${r.qty} shares of ${r.isin} from ${r.pledgorBoId} (agreement ${r.agreementNo}).`);
  })();
  if (pledgee.account.standing_auto_accept && timing.businessOpen) accept(db, psn);
  return getPledge(db, psn)!;
}

export function accept(db: DB, psn: string): DepPledge {
  const p = getPledge(db, psn) ?? fail("Unknown PSN");
  if (p.status !== "SETUP" && p.status !== "REPORTED") fail(`Pledge is ${p.status}`);
  db.transaction(() => {
    if (!p.guided) {
      db.prepare(
        "INSERT INTO dep_holdings(bo_id, isin, pledgee_balance) VALUES(?, ?, ?) ON CONFLICT(bo_id, isin) DO UPDATE SET pledgee_balance = pledgee_balance + excluded.pledgee_balance",
      ).run(p.pledgee, p.isin, p.qty);
    }
    db.prepare("UPDATE dep_pledges SET status = 'ACCEPTED', updated_at = ? WHERE psn = ?").run(now(), psn);
    inbox(db, p.pledgor, `Pledge ${psn} accepted`, `${p.qty} shares of ${p.isin} are now pledged to ${p.pledgee}.`);
  })();
  return getPledge(db, psn)!;
}

function closeState(p: DepPledge, invoked: number, released: number): PledgeState {
  return invoked + released >= p.qty ? "CLOSED" : invoked + released > 0 ? "PARTIALLY_CLOSED" : p.status;
}

/** Pledgee invokes (CDSL: "confiscates") shares, in full or in part, without any action by the pledgor. */
export function invoke(db: DB, psn: string, qty: number): DepPledge {
  const p = getPledge(db, psn) ?? fail("Unknown PSN");
  if (!["ACCEPTED", "PARTIALLY_CLOSED"].includes(p.status)) fail(`Pledge is ${p.status}`);
  if (!Number.isInteger(qty) || qty <= 0 || qty > remainingOf(p)) fail("Quantity exceeds what is still pledged");
  db.transaction(() => {
    if (!p.guided) {
      db.prepare("UPDATE dep_holdings SET pledged = pledged - ? WHERE bo_id = ? AND isin = ?").run(qty, p.pledgor, p.isin);
      db.prepare("UPDATE dep_holdings SET free = free + ?, pledgee_balance = pledgee_balance - ? WHERE bo_id = ? AND isin = ?").run(qty, qty, p.pledgee, p.isin);
    }
    db.prepare("UPDATE dep_pledges SET invoked = invoked + ?, status = ?, updated_at = ? WHERE psn = ?").run(qty, closeState(p, p.invoked + qty, p.released), now(), psn);
    inbox(db, p.pledgor, `Pledge ${psn} invoked`, `${qty} shares of ${p.isin} were invoked by ${p.pledgee}.`);
    inbox(db, p.pledgee, `Invocation on ${psn}`, `${qty} shares of ${p.isin} credited to your account.`);
  })();
  return getPledge(db, psn)!;
}

/** Unpledge (release) in full or in part, from either side. */
export function release(db: DB, psn: string, qty: number): DepPledge {
  const p = getPledge(db, psn) ?? fail("Unknown PSN");
  if (!["ACCEPTED", "PARTIALLY_CLOSED"].includes(p.status)) fail(`Pledge is ${p.status}`);
  if (!Number.isInteger(qty) || qty <= 0 || qty > remainingOf(p)) fail("Quantity exceeds what is still pledged");
  db.transaction(() => {
    if (!p.guided) {
      db.prepare("UPDATE dep_holdings SET pledged = pledged - ?, free = free + ? WHERE bo_id = ? AND isin = ?").run(qty, qty, p.pledgor, p.isin);
      db.prepare("UPDATE dep_holdings SET pledgee_balance = pledgee_balance - ? WHERE bo_id = ? AND isin = ?").run(qty, p.pledgee, p.isin);
    }
    db.prepare("UPDATE dep_pledges SET released = released + ?, status = ?, updated_at = ? WHERE psn = ?").run(qty, closeState(p, p.invoked, p.released + qty), now(), psn);
    inbox(db, p.pledgor, `Unpledge on ${psn}`, `${qty} shares of ${p.isin} returned to your free balance.`);
  })();
  return getPledge(db, psn)!;
}

/** Auto-accept requests whose business day has come; reject requests nobody accepted within `ttl` seconds. */
export function processDue(db: DB, businessOpen: boolean, ttl: number): { accepted: string[]; rejected: string[] } {
  const accepted: string[] = [];
  const rejected: string[] = [];
  const t = now();
  const pending = db.prepare("SELECT * FROM dep_pledges WHERE status = 'SETUP' AND guided = 0").all() as DepPledge[];
  for (const p of pending) {
    if (t - p.created_at > ttl) {
      db.transaction(() => {
        db.prepare("UPDATE dep_holdings SET pledged = pledged - ?, free = free + ? WHERE bo_id = ? AND isin = ?").run(p.qty, p.qty, p.pledgor, p.isin);
        db.prepare("UPDATE dep_pledges SET status = 'REJECTED', updated_at = ? WHERE psn = ?").run(t, p.psn);
        inbox(db, p.pledgor, `Pledge request ${p.psn} rejected`, "The pledgee did not accept it in time.");
      })();
      rejected.push(p.psn);
      continue;
    }
    const auto = (db.prepare("SELECT standing_auto_accept FROM dep_accounts WHERE bo_id = ?").get(p.pledgee) as { standing_auto_accept: number })?.standing_auto_accept;
    if (auto && businessOpen && t >= p.process_after) {
      accept(db, p.psn);
      accepted.push(p.psn);
    }
  }
  return { accepted, rejected };
}

// ------------------------------------------------------------------ guided (real CDSL Easiest)

export const EASIEST_URL = "https://web.cdslindia.com/myeasitoken/Home/Login";

export function guidedInstructions(r: { pledgeeBoId: string; isin: string; qty: number; agreementNo: string; closureDate: string }) {
  return {
    url: EASIEST_URL,
    steps: [
      "Log in to CDSL Easiest with your BO ID and password.",
      `If you have not already, add ${r.pledgeeBoId} as a trusted account (takes about 24 working hours).`,
      "Open Pledge, choose Pledgor, then Pledge Setup.",
      `Pledgee BO ID: ${r.pledgeeBoId}. ISIN: ${r.isin}. Quantity: ${r.qty}.`,
      `Agreement number: ${r.agreementNo}. Closure date: ${r.closureDate}.`,
      "Commit with your Easiest PIN. Requests made before 4 PM on a business day are processed the same day.",
      "Copy the pledge sequence number (PSN) from the confirmation and paste it here.",
    ],
  };
}

export function reportGuided(
  db: DB,
  r: { pledgorBoId: string; pledgeeBoId: string; isin: string; qty: number; agreementNo: string; psn: string; execDate: string },
): DepPledge {
  if (!BO_ID.test(r.pledgorBoId) || !BO_ID.test(r.pledgeeBoId)) fail("A CDSL BO ID has 16 digits");
  if (!/^[A-Za-z0-9-]{6,32}$/.test(r.psn)) fail("That does not look like a pledge sequence number");
  if (getPledge(db, r.psn)) fail("This PSN is already registered");
  if (pledgeByAgreement(db, r.agreementNo)) fail("A pledge with this agreement number already exists");
  const t = now();
  db.prepare(
    "INSERT INTO dep_pledges(psn, pledgor, pledgee, isin, qty, status, agreement_no, exec_date, guided, created_at, updated_at) VALUES(?, ?, ?, ?, ?, 'REPORTED', ?, ?, 1, ?, ?)",
  ).run(r.psn, r.pledgorBoId, r.pledgeeBoId, r.isin, r.qty, r.agreementNo, r.execDate, t, t);
  return getPledge(db, r.psn)!;
}
