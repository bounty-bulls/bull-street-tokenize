import { Hono } from "hono";
import { db } from "../ctx";

const SHOWN = [
  "PledgeOpened",
  "PledgeAttested",
  "Minted",
  "OrderFilled",
  "TicketCreated",
  "AllocationCreated",
  "Cured",
  "Settled",
  "DefaultClaimed",
  "ReservePaid",
  "BatchClaimed",
  "StaleSlashed",
  "BrokerStatusChanged",
];

/** Recent protocol events from the indexer, newest first. `?names=A,B` filters, `?asset=1` by asset. */
export const activity = new Hono();

activity.get("/", (c) => {
  const names = (c.req.query("names")?.split(",") ?? SHOWN).filter((n) => /^[A-Za-z]+$/.test(n));
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const rows = db
    .prepare(`SELECT * FROM events WHERE name IN (${names.map(() => "?").join(",")}) ORDER BY block DESC, log_index DESC LIMIT ?`)
    .all(...names, limit * 3) as { args: string; name: string; block: number; tx: string; ts: number; contract: string }[];
  const asset = c.req.query("asset");
  const items = rows
    .map((r) => ({ ...r, args: JSON.parse(r.args) }))
    .filter((r) => !asset || r.args.assetId === undefined || String(r.args.assetId) === asset)
    .slice(0, limit);
  return c.json(items);
});

/** Trades for one asset (OrderFilled), for the trade page's recent trades and price history. */
activity.get("/trades/:assetId", (c) => {
  const rows = db
    .prepare("SELECT * FROM events WHERE name = 'OrderFilled' ORDER BY block DESC, log_index DESC LIMIT 500")
    .all() as { args: string; block: number; tx: string; ts: number }[];
  const id = c.req.param("assetId");
  return c.json(
    rows
      .map((r) => ({ ...r, args: JSON.parse(r.args) }))
      .filter((r) => String(r.args.assetId) === id)
      .slice(0, 100),
  );
});
