/**
 * Deploys Bull Street with the right environment for the target chain.
 *
 *   pnpm deploy:local   anvil at 127.0.0.1:8545, MockUSDC, compressed calendar
 *   pnpm deploy:arc     Arc testnet, USDC at 0x3600..., CALENDAR_MODE from .env (default compressed)
 *
 * Oracle signers are the oracleA/B/C personas from DEMO_MNEMONIC (or ORACLE_PKS); the World attestor is
 * WORLD_ATTESTOR_PRIVATE_KEY. Writes deploy/<chainId>/addresses.json.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ARC_USDC } from "../services/shared/src/chains";
import { env, keyAccount, loadEnv, persona, repoRoot } from "../services/shared/src/node";

loadEnv();
const target = process.argv[2] ?? "local";
const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const oracle = process.env.ORACLE_PKS
  ? process.env.ORACLE_PKS.split(",").map((k) => keyAccount(k).address)
  : (["oracleA", "oracleB", "oracleC"] as const).map((k) => persona(k).address);

const vars: Record<string, string> = {
  DEPLOYER_PRIVATE_KEY: target === "local" ? ANVIL_KEY : env("DEPLOYER_PRIVATE_KEY"),
  WORLD_ATTESTOR_ADDRESS: keyAccount(env("WORLD_ATTESTOR_PRIVATE_KEY")).address,
  ORACLE_SIGNERS: oracle.join(","),
  ORACLE_THRESHOLD: process.env.ORACLE_THRESHOLD ?? "2",
  CALENDAR_MODE: target === "local" ? "compressed" : (process.env.CALENDAR_MODE ?? "compressed"),
  DEMO_SCALE: target === "local" ? (process.env.LOCAL_DEMO_SCALE ?? "1") : (process.env.DEMO_SCALE ?? "10"),
};
if (target !== "local") vars.USDC_ADDRESS = process.env.USDC_ADDRESS ?? ARC_USDC;
if (process.env.TREASURY) vars.TREASURY = process.env.TREASURY;

const rpc = target === "local" ? "http://127.0.0.1:8545" : env("RPC_URL", "https://rpc.testnet.arc.network");
const args = ["script", "script/Deploy.s.sol", "--rpc-url", rpc, "--broadcast"];
if (target !== "local") args.push("--slow");

console.log(`Deploying to ${target} (${rpc}) with calendar ${vars.CALENDAR_MODE}, scale ${vars.DEMO_SCALE}`);
if (target === "local") {
  // Multicall3 at its canonical address (copied from Arc testnet) so batched reads work on anvil too.
  const MC = "0xcA11bde05977b3631167028862bE2a173976CA11";
  const code = spawnSync("cast", ["code", MC, "--rpc-url", "https://rpc.testnet.arc.network"], { encoding: "utf8" }).stdout.trim();
  if (code.length > 4) spawnSync("cast", ["rpc", "anvil_setCode", MC, code, "--rpc-url", rpc], { stdio: "ignore" });
}
const childEnv: Record<string, string | undefined> = { ...process.env, ...vars };
if (target === "local") delete childEnv.USDC_ADDRESS;
const r = spawnSync("forge", args, { cwd: join(repoRoot, "contracts"), stdio: "inherit", env: childEnv as NodeJS.ProcessEnv });
process.exit(r.status ?? 1);
