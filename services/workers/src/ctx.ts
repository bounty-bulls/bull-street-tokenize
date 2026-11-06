import type { Abi, Address, Hex } from "viem";
import type { HDAccount, PrivateKeyAccount } from "viem/accounts";
import { clients, env, keyAccount, loadDeployment, loadEnv, persona } from "@bullstreet/shared/node";
import { openDb } from "@bullstreet/shared/db";
import type { PersonaKey } from "@bullstreet/shared";

loadEnv();

export const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);
export const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
export const d = loadDeployment(CHAIN_ID);
export const db = openDb();
export const { publicClient, wallet, chain } = clients(CHAIN_ID, RPC_URL);

type Account = HDAccount | PrivateKeyAccount;

/** Oracle signer keys: ORACLE_PKS (comma separated) or the oracleA/B/C personas. */
export function oracleSigners(): Account[] {
  const pks = process.env.ORACLE_PKS?.split(",").filter(Boolean);
  if (pks?.length) return pks.map(keyAccount);
  return (["oracleA", "oracleB", "oracleC"] as PersonaKey[]).map((k) => persona(k));
}

export const keeperAccount = (): Account =>
  process.env.KEEPER_PRIVATE_KEY ? keyAccount(process.env.KEEPER_PRIVATE_KEY) : persona("keeper");

/** Broker agents: main wallet (pays settlements, holds the bond) and a delegate hot key (signs and sends). */
export function brokerAgents(): { name: string; main: Account; agent: Account }[] {
  const list = (process.env.BROKER_AGENTS ?? "brokerX:agentX,brokerY:agentY,brokerZ:agentZ").split(",").filter(Boolean);
  return list.map((pair) => {
    const [main, agent] = pair.split(":") as [PersonaKey, PersonaKey];
    return { name: main, main: persona(main), agent: persona(agent) };
  });
}

const locks = new Map<string, Promise<unknown>>();

/** Sends a transaction from `account`, one at a time per account, and waits for the receipt. */
/** viem never retries eth_sendRawTransaction; a 429 means the node refused it, so sending again is safe */
async function rateLimited<T>(fn: () => Promise<T>, tries = 8): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const limited = /rate limit|exceeds defined limit|429/i.test(String(e?.details ?? e?.shortMessage ?? e?.message ?? ""));
      if (!limited || i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** Math.min(i, 4)));
    }
  }
}

export async function send(account: Account, address: Address, abi: Abi | readonly unknown[], functionName: string, args: readonly unknown[] = []) {
  const key = account.address;
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    const w = wallet(account);
    const { request } = await publicClient.simulateContract({ account, address, abi: abi as Abi, functionName, args } as any);
    const hash: Hex = await rateLimited(() => w.writeContract(request as any));
    const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (r.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
    return r;
  });
  locks.set(key, run);
  return run;
}

export const read = <T = any>(address: Address, abi: Abi | readonly unknown[], functionName: string, args: readonly unknown[] = []) =>
  publicClient.readContract({ address, abi: abi as Abi, functionName, args } as any) as Promise<T>;

/**
 * Chain time: the latest block's timestamp plus wall-clock time elapsed since it was read. Deadlines are
 * enforced by the contracts on chain time, so the workers use it too (it also follows time warps on anvil).
 */
let chainBase = { chain: Math.floor(Date.now() / 1000), wall: Date.now() };
export async function syncClock(): Promise<void> {
  const b = await publicClient.getBlock();
  // an idle local chain lags wall time; a warped one runs ahead of it
  chainBase = { chain: Math.max(Number(b.timestamp), Math.floor(Date.now() / 1000)), wall: Date.now() };
}
export const nowSec = () => chainBase.chain + Math.floor((Date.now() - chainBase.wall) / 1000);

export function log(scope: string, msg: string, extra?: unknown) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`${t} [${scope}] ${msg}`, extra === undefined ? "" : extra);
}

export const errMsg = (e: unknown) => (e as any)?.shortMessage ?? (e as any)?.message ?? String(e);

export { env };
