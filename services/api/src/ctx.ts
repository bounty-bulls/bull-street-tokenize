import { clients, env, keyAccount, loadDeployment, loadEnv } from "@bullstreet/shared/node";
import { openDb } from "@bullstreet/shared/db";
import { sessionClockAbi, type Deployment } from "@bullstreet/shared";

loadEnv();

/** Server configuration. Private keys stay in this process; the browser never sees them. */
export const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);
export const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
export const PORT = Number(process.env.API_PORT ?? 8790);
export const WORLD = {
  rpId: process.env.WORLD_RP_ID ?? process.env.NEXT_PUBLIC_WORLD_RP_ID ?? "",
  appId: process.env.NEXT_PUBLIC_WORLD_APP_ID ?? "",
  signingKey: process.env.WORLD_RP_SIGNING_KEY ?? "",
  env: process.env.WORLD_ENV ?? process.env.NEXT_PUBLIC_WORLD_ENV ?? "staging",
  action: process.env.WORLD_ACTION ?? "bullstreet-role-v1",
};
/** Lets the ops console register a role without a World ID scan (local chains or explicit opt-in only). */
export const ALLOW_DEV_IDENTITY = CHAIN_ID === 31337 || process.env.ALLOW_DEV_IDENTITY === "true";

export const db = openDb();
export const { publicClient, wallet, chain } = clients(CHAIN_ID, RPC_URL);

let dep: Deployment | undefined;
export function deployment(): Deployment {
  dep ??= loadDeployment(CHAIN_ID);
  return dep;
}

export function worldAttestor() {
  return keyAccount(env("WORLD_ATTESTOR_PRIVATE_KEY"));
}

/** Business days: CDSL processes requests except at weekends and holidays (an extended closure). */
export async function businessTiming(): Promise<{ businessOpen: boolean; nextBusiness: number }> {
  const d = deployment();
  const [ext, nextOpen] = await Promise.all([
    publicClient.readContract({ address: d.sessionClock, abi: sessionClockAbi, functionName: "extendedClosure" }),
    publicClient.readContract({ address: d.sessionClock, abi: sessionClockAbi, functionName: "nextSessionOpen" }),
  ]);
  return { businessOpen: !ext, nextBusiness: Number(nextOpen) };
}

export const jsonSafe = (v: unknown) =>
  JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
