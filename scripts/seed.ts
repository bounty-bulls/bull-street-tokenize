/**
 * Seeds a deployment with brokers, minters, pledges, minted tokens and a few orders on the book.
 * Idempotent: re-running skips what already exists.
 *
 *   pnpm seed            (uses CHAIN_ID / RPC_URL from .env; local by default)
 *
 * On a local chain personas get ETH for gas and MockUSDC. On Arc, USDC is both gas and money, so the
 * deployer transfers USDC to each persona (amounts below, scaled to the deployment's tier caps).
 */
import { keccak256, parseEther, toHex, type Address } from "viem";
import {
  ASSETS,
  Role,
  Side,
  bondVaultAbi,
  brokerRegistryAbi,
  domain,
  exchangeAbi,
  mockUsdcAbi,
  paramKey,
  paramsAbi,
  pledgeRegistryAbi,
  priceOracleAbi,
  randomNonce,
  roleAttestationTypes,
  roleRegistryAbi,
  stockTokenAbi,
  type PersonaKey,
} from "../services/shared/src/index";
import { env, keyAccount, persona } from "../services/shared/src/node";
import { createAccount, setupPledge, agreementFor, pledgeByAgreement } from "../services/shared/src/depository";
import { now } from "../services/shared/src/db";
import { CHAIN_ID, d, db, nowSec, publicClient, read, send, syncClock, wallet } from "../services/workers/src/ctx";
import { postPrices, postSessions } from "../services/workers/src/oracle";
import { brokerTick } from "../services/workers/src/brokerAgent";

const LOCAL = CHAIN_ID === 31337;
const MAX = 2n ** 256n - 1n;
const deployer = keyAccount(LOCAL ? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" : env("DEPLOYER_PRIVATE_KEY"));
const world = keyAccount(env("WORLD_ATTESTOR_PRIVATE_KEY"));
const usd = (x: number) => BigInt(Math.round(x * 1e6));
const P = (k: PersonaKey) => persona(k);

const BROKERS: { key: PersonaKey; agent: PersonaKey; boId: string; name: string }[] = [
  { key: "brokerX", agent: "agentX", boId: "1208160000000101", name: "Northgate Securities" },
  { key: "brokerY", agent: "agentY", boId: "1208160000000102", name: "Banyan Pledge Services" },
  { key: "brokerZ", agent: "agentZ", boId: "1208160000000103", name: "Tidewater Custody" },
];
const MINTERS: { key: PersonaKey; boId: string; name: string; broker: PersonaKey; volunteer?: boolean }[] = [
  { key: "alice", boId: "1208160000001001", name: "Alice", broker: "brokerX" },
  { key: "carol", boId: "1208160000001002", name: "Carol", broker: "brokerY" },
  { key: "dev", boId: "1208160000001003", name: "Dev", broker: "brokerZ", volunteer: true },
];

async function fund(to: Address, usdc: bigint, gas = true) {
  if (LOCAL) {
    if (gas && (await publicClient.getBalance({ address: to })) < parseEther("1")) {
      const h = await wallet(deployer).sendTransaction({ to, value: parseEther("5") });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }
    const bal = await read<bigint>(d.usdc, mockUsdcAbi, "balanceOf", [to]);
    if (bal < usdc) await send(deployer, d.usdc, mockUsdcAbi, "mint", [to, usdc - bal]);
  } else {
    const bal = await read<bigint>(d.usdc, mockUsdcAbi, "balanceOf", [to]);
    if (bal < usdc) await send(deployer, d.usdc, mockUsdcAbi, "transfer", [to, usdc - bal]);
  }
}

async function approve(who: PersonaKey, token: Address, spender: Address) {
  const acc = P(who);
  const cur = await read<bigint>(token, mockUsdcAbi, "allowance", [acc.address, spender]);
  if (cur < MAX / 2n) await send(acc, token, mockUsdcAbi, "approve", [spender, MAX]);
}

async function register(who: PersonaKey, role: number) {
  const acc = P(who);
  if (Number(await read(d.roles, roleRegistryAbi, "roleOf", [acc.address])) !== 0) return;
  const attestation = { wallet: acc.address, role, nullifierHash: keccak256(toHex(`seed:${who}`)), expiry: BigInt(nowSec() + 900), nonce: randomNonce() };
  const sig = await world.signTypedData({ domain: domain(CHAIN_ID, d.roles), types: roleAttestationTypes, primaryType: "RoleAttestation", message: attestation });
  await send(acc, d.roles, roleRegistryAbi, "register", [attestation, sig]);
  console.log(`  ${who} registered as ${role === Role.Minter ? "minter" : "broker"}`);
}

async function main() {
  console.log(`Seeding chain ${CHAIN_ID}`);
  await syncClock(); // chain time (a local chain may have been moved forward)
  if (LOCAL) {
    // let the app's local account switcher send transactions as the seeded personas
    for (const k of ["alice", "carol", "dev", "brokerX", "brokerY", "brokerZ", "bob", "eve", "fay"] as PersonaKey[]) {
      await publicClient.request({ method: "anvil_impersonateAccount" as any, params: [P(k).address] as any });
    }
  }
  const param = async (k: string) => read<bigint>(d.params, paramsAbi, "get", [paramKey(k)]);
  // the oracle needs gas before it can post the calendar and the closes the sizing uses
  for (const k of ["oracleA", "keeper"] as PersonaKey[]) await fund(P(k).address, LOCAL ? 0n : usd(2));
  // pledge size: SEED_PLEDGE_SHARES, or 70% of the tier-1 cap on a local chain
  await postSessions();
  await postPrices();
  const [relClose] = await read<[bigint, number, bigint]>(d.priceOracle, priceOracleAbi, "closeOf", [ASSETS[0].id]);
  let cap1 = await param("TIER_CAP_1");
  const shares = Number(process.env.SEED_PLEDGE_SHARES ?? Math.max(1, Number(((cap1 * 7n) / 10n) / relClose)));
  const value = BigInt(shares) * relClose;
  if (value > cap1) {
    cap1 = (value * 12n) / 10n;
    await send(deployer, d.params, paramsAbi, "set", [paramKey("TIER_CAP_1"), cap1]);
  }
  let minBond = await param("MIN_BOND_1");
  const needBond = (value * 115n) / 100n + 1_000_000n; // covers 110% (125% over long closures is checked only on new pledges)
  if (!LOCAL && minBond > needBond) {
    // keep testnet bonds small: the tier minimum only needs to cover the seeded pledge
    minBond = needBond;
    await send(deployer, d.params, paramsAbi, "set", [paramKey("MIN_BOND_1"), minBond]);
  }
  const bond = (minBond > needBond ? minBond : needBond) + (LOCAL ? 0n : 1_000_000n);
  const holderUsdc = LOCAL ? usd(50_000) : usd(Number(process.env.SEED_HOLDER_USDC ?? 20));
  console.log(`   pledges of ${shares} shares, broker bonds of ${Number(bond) / 1e6} USDC`);

  // 1. money and gas
  console.log("1. funding wallets");
  for (const k of ["oracleA", "keeper", "agentX", "agentY", "agentZ"] as PersonaKey[]) await fund(P(k).address, LOCAL ? 0n : usd(2));
  for (const b of BROKERS) await fund(P(b.key).address, bond + (LOCAL ? usd(50_000) : usd(Number(process.env.SEED_BROKER_EXTRA ?? 2))));
  for (const m of MINTERS) await fund(P(m.key).address, LOCAL ? usd(10_000) : usd(Number(process.env.SEED_MINTER_USDC ?? 2)));
  await fund(P("bob").address, holderUsdc);
  for (const k of ["eve", "fay"] as PersonaKey[]) await fund(P(k).address, LOCAL ? usd(5_000) : usd(1));

  // 2. calendar and prices
  console.log("2. sessions and prices");
  await postSessions();
  await postPrices();

  if (process.env.SEED_SMALL_MAX) await send(deployer, d.params, paramsAbi, "set", [paramKey("SMALL_MAX"), BigInt(process.env.SEED_SMALL_MAX)]);

  // 3. roles
  console.log("3. roles");
  for (const b of BROKERS) await register(b.key, Role.Broker);
  for (const m of MINTERS) await register(m.key, Role.Minter);

  // 4. brokers
  console.log("4. brokers");
  for (const b of BROKERS) {
    const acc = P(b.key);
    const info = await read<any>(d.brokers, brokerRegistryAbi, "brokerOf", [acc.address]);
    if (Number(info.status) === 0) {
      await send(acc, d.brokers, brokerRegistryAbi, "join", [0, keccak256(toHex(b.boId)), P(b.agent).address, b.name]);
    }
    await approve(b.key, d.usdc, d.bondVault);
    await approve(b.key, d.usdc, d.redemption);
    await approve(b.key, d.usdc, d.exchange);
    const have = await read<bigint>(d.bondVault, bondVaultAbi, "bondOf", [acc.address]);
    if (have < bond) await send(acc, d.bondVault, bondVaultAbi, "deposit", [bond - have]);
    db.prepare(
      "INSERT INTO broker_profiles(wallet, bo_id, name, created_at) VALUES(?, ?, ?, ?) ON CONFLICT(wallet) DO NOTHING",
    ).run(acc.address.toLowerCase(), b.boId, b.name, now());
    createAccount(db, { boId: b.boId, ownerWallet: acc.address, name: b.name, standingAutoAccept: true });
    console.log(`  ${b.name} active with ${Number(bond) / 1e6} USDC bond`);
  }

  // 5. minters: demat accounts, pledges, mints
  console.log("5. minters");
  const rel = ASSETS[0];
  const close = relClose;
  for (const m of MINTERS) {
    const acc = P(m.key);
    createAccount(db, { boId: m.boId, ownerWallet: acc.address, name: m.name, holdings: { [rel.isin]: shares * 4, [ASSETS[1].isin]: 50, [ASSETS[2].isin]: 200 } });
    await approve(m.key, d.usdc, d.pledges);
    await approve(m.key, d.usdc, d.redemption);
    await approve(m.key, d.tokens[0], d.exchange);
    const existing = await read<bigint[]>(d.pledges, pledgeRegistryAbi, "pledgesOf", [acc.address]);
    if (existing.length) continue;
    const broker = P(m.broker).address;
    const { result: pledgeId } = await publicClient.simulateContract({
      account: acc,
      address: d.pledges,
      abi: pledgeRegistryAbi,
      functionName: "openPledge",
      args: [rel.id, BigInt(shares), broker, false],
    });
    await send(acc, d.pledges, pledgeRegistryAbi, "openPledge", [rel.id, BigInt(shares), broker, false]);
    if (!pledgeByAgreement(db, agreementFor(pledgeId))) {
      const brokerBo = BROKERS.find((b) => b.key === m.broker)!.boId;
      setupPledge(
        db,
        { pledgorBoId: m.boId, pledgeeBoId: brokerBo, isin: rel.isin, qty: shares, agreementNo: agreementFor(pledgeId), execDate: new Date().toISOString().slice(0, 10) },
        { businessOpen: true, nextBusiness: now() },
      );
    }
    console.log(`  ${m.name} pledged ${shares} ${rel.ticker} to ${m.broker} (#${pledgeId})`);
  }
  console.log("   broker agents attesting");
  await brokerTick();

  for (const [i, m] of MINTERS.entries()) {
    const acc = P(m.key);
    const [id] = await read<bigint[]>(d.pledges, pledgeRegistryAbi, "pledgesOf", [acc.address]);
    const p = await read<any>(d.pledges, pledgeRegistryAbi, "pledgeOf", [id]);
    if (Number(p.status) !== 2) {
      console.log(`  pledge #${id} not active yet (status ${p.status}); run the workers and re-seed`);
      continue;
    }
    if (p.m === 0n) {
      const n = BigInt(Math.max(1, Math.floor(shares * [0.6, 0.4, 0.3][i])));
      await send(acc, d.pledges, pledgeRegistryAbi, "mint", [id, n]);
      console.log(`  ${m.name} minted ${n} b${rel.ticker}`);
    }
    if (m.volunteer && !p.volunteer) await send(acc, d.pledges, pledgeRegistryAbi, "setVolunteer", [id, true]);
  }

  // 6. order book
  console.log("6. order book");
  const alice = P("alice");
  const orders = await read<bigint[]>(d.exchange, exchangeAbi, "ordersOf", [alice.address]);
  if (!orders.length) {
    const balance = await read<bigint>(d.tokens[0], stockTokenAbi, "balanceOf", [alice.address]);
    const lot = balance / 4n;
    for (const bps of [50n, 100n, 200n]) {
      const price = (close * (10_000n + bps)) / 10_000n;
      if (lot > 0n) await send(alice, d.exchange, exchangeAbi, "trade", [{ assetId: rel.id, side: Side.Sell, limitPrice: price, amount: lot, fillIds: [], rest: true, expiry: 0n, minFilled: 0n }]);
    }
    const x = P("brokerX");
    for (const bps of [50n, 100n, 200n]) {
      const price = (close * (10_000n - bps)) / 10_000n;
      const amount = 10n ** 18n * BigInt(Math.max(1, Math.floor(shares / 10)));
      await send(x, d.exchange, exchangeAbi, "trade", [{ assetId: rel.id, side: Side.Buy, limitPrice: price, amount, fillIds: [], rest: true, expiry: 0n, minFilled: 0n }]);
    }
    console.log("  3 asks from Alice, 3 bids from Northgate");
  }

  for (const k of ["bob", "eve", "fay"] as PersonaKey[]) {
    await approve(k, d.usdc, d.exchange);
    for (const t of d.tokens) {
      await approve(k, t, d.exchange);
      await approve(k, t, d.redemption);
    }
  }
  console.log("Done.");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
