/** Node-only helpers (filesystem, env, signers). Not imported by the web app. */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { mnemonicToAccount, privateKeyToAccount, type HDAccount, type PrivateKeyAccount } from "viem/accounts";
import { chainById } from "./chains";
import type { Deployment } from "./deployment";
import { PERSONA_INDEX, type PersonaKey } from "./personas";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Loads KEY=VALUE lines from the repo-root .env into process.env (without overriding). */
export function loadEnv(file = join(repoRoot, ".env")): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const raw = m[2].trim();
    const v = raw.startsWith('"') ? raw.replace(/^"(.*)"$/, "$1") : raw.replace(/\s+#.*$/, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

export function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`missing env ${name}`);
  return v;
}

export function loadDeployment(chainId: number): Deployment {
  const file = join(repoRoot, "deploy", String(chainId), "addresses.json");
  if (!existsSync(file)) throw new Error(`no deployment for chain ${chainId} (${file}); run the deploy script`);
  return JSON.parse(readFileSync(file, "utf8")) as Deployment;
}

export function persona(key: PersonaKey, mnemonic = env("DEMO_MNEMONIC")): HDAccount {
  return mnemonicToAccount(mnemonic, { addressIndex: PERSONA_INDEX[key] });
}

export function keyAccount(pk: string): PrivateKeyAccount {
  return privateKeyToAccount(pk as Hex);
}

export function clients(chainId: number, rpcUrl: string) {
  const chain = chainById(chainId);
  const transport = http(rpcUrl, { retryCount: 8, retryDelay: 800, timeout: 30_000 }); // the public Arc RPC rate-limits (429): back off and retry
  const publicClient = createPublicClient({ chain, transport });
  const wallet = (account: HDAccount | PrivateKeyAccount) => createWalletClient({ chain, transport, account });
  return { chain, publicClient, wallet };
}
