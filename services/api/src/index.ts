import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { CHAIN_ID, PORT, deployment } from "./ctx";
import { activity } from "./routes/activity";
import { dep } from "./routes/dep";
import { notices } from "./routes/notices";
import { plan } from "./routes/plan";
import { snapshot } from "./routes/snapshot";
import { world } from "./routes/world";

const app = new Hono();
app.use("*", cors());
app.get("/health", (c) => c.json({ ok: true, chainId: CHAIN_ID }));
app.get("/deployment", (c) => c.json(deployment()));
app.route("/snapshot", snapshot);
app.route("/world", world);
app.route("/dep", dep);
app.route("/plan", plan);
app.route("/notices", notices);
app.route("/activity", activity);
app.onError((err, c) => {
  console.error(err);
  const msg = (err as any)?.shortMessage ?? err.message ?? "Server error";
  return c.json({ error: msg }, 500);
});

serve({ fetch: app.fetch, port: PORT }, (info) => console.log(`Bull Street API on :${info.port} (chain ${CHAIN_ID})`));
