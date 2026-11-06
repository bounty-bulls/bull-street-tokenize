import { Hono } from "hono";
import { PERSONAS } from "@bullstreet/shared";
import { persona } from "@bullstreet/shared/node";

/** Public addresses of the seeded accounts, so the app can label them (and offer them on a local chain). */
export const personas = new Hono();

personas.get("/", (c) => {
  if (!process.env.DEMO_MNEMONIC) return c.json([]);
  return c.json(PERSONAS.map((p) => ({ ...p, address: persona(p.key).address })));
});
