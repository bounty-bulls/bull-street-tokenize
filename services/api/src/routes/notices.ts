import { Hono } from "hono";
import { db } from "../ctx";

/** In-app notices: CDSL alerts, cure deadlines, payouts and fills, written by the workers. */
export const notices = new Hono();

notices.get("/:wallet", (c) => {
  const w = c.req.param("wallet").toLowerCase();
  const rows = db.prepare("SELECT * FROM notices WHERE wallet = ? ORDER BY ts DESC, id DESC LIMIT 50").all(w);
  const unread = (db.prepare("SELECT COUNT(*) AS n FROM notices WHERE wallet = ? AND read = 0").get(w) as { n: number }).n;
  return c.json({ unread, items: rows });
});

notices.post("/:wallet/read", (c) => {
  db.prepare("UPDATE notices SET read = 1 WHERE wallet = ?").run(c.req.param("wallet").toLowerCase());
  return c.json({ ok: true });
});
