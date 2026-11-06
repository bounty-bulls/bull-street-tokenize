import { Hono } from "hono";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { encodePacked, isAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { Role, domain, randomNonce, roleAttestationTypes, roleRegistryAbi } from "@bullstreet/shared";
import { now } from "@bullstreet/shared/db";
import { ALLOW_DEV_IDENTITY, CHAIN_ID, WORLD, db, deployment, jsonSafe, publicClient, worldAttestor } from "../ctx";

/**
 * World ID: the trust moment is taking a minter or broker role. One person may hold only one role, so the
 * same person cannot be both the minter and the broker of a pledge. Proof of Human is the minimum credential
 * that gives a unique, anonymous per-app identifier and nothing else.
 *
 * Flow: rp-context (server signs the request) -> IDKit in the browser -> /verify (Developer Portal check,
 * signal check, uniqueness) -> EIP-712 RoleAttestation -> RoleRegistry.register on-chain.
 */
export const world = new Hono();

world.post("/rp-context", async (c) => {
  if (!WORLD.signingKey || !WORLD.rpId) return c.json({ error: "World ID is not configured" }, 501);
  const s = signRequest({ signingKeyHex: WORLD.signingKey, action: WORLD.action });
  return c.json({
    rp_id: WORLD.rpId,
    app_id: WORLD.appId,
    action: WORLD.action,
    environment: WORLD.env,
    sig: s.sig,
    nonce: s.nonce,
    created_at: s.createdAt,
    expires_at: s.expiresAt,
  });
});

async function attest(wallet: Address, role: number, nullifierHash: Hex) {
  const d = deployment();
  const existing = await publicClient.readContract({
    address: d.roles,
    abi: roleRegistryAbi,
    functionName: "roleOfNullifier",
    args: [nullifierHash],
  });
  if (Number(existing) !== 0) return { error: "ROLE_TAKEN" as const };
  const current = await publicClient.readContract({ address: d.roles, abi: roleRegistryAbi, functionName: "roleOf", args: [wallet] });
  if (Number(current) !== 0) return { error: "WALLET_HAS_ROLE" as const };

  const signer = worldAttestor();
  const attestation = { wallet, role, nullifierHash, expiry: BigInt(now() + 15 * 60), nonce: randomNonce() };
  const signature = await signer.signTypedData({
    domain: domain(CHAIN_ID, d.roles),
    types: roleAttestationTypes,
    primaryType: "RoleAttestation",
    message: attestation,
  });
  db.prepare("INSERT OR IGNORE INTO world_roles(nullifier, role, wallet, created_at) VALUES(?, ?, ?, ?)").run(
    nullifierHash,
    role,
    wallet.toLowerCase(),
    now(),
  );
  return { attestation: jsonSafe(attestation), signature };
}

world.post("/verify", async (c) => {
  if (!WORLD.rpId) return c.json({ error: "World ID is not configured" }, 501);
  const { idkitResponse: r, wallet, role } = (await c.req.json()) as { idkitResponse: any; wallet: Address; role: number };
  if (!isAddress(wallet) || (role !== Role.Minter && role !== Role.Broker)) return c.json({ code: "INVALID", error: "Bad input" }, 400);
  if (r?.environment !== WORLD.env || r?.protocol_version !== "4.0" || r?.action !== WORLD.action) {
    return c.json({ code: "INVALID", error: "Unexpected environment, protocol or action" }, 400);
  }
  const item = r.responses?.[0];
  if (!item || item.issuer_schema_id !== 1) return c.json({ code: "INVALID", error: "Proof of Human is required" }, 400);
  const expected = hashSignal(encodePacked(["uint8", "address"], [role, wallet])).toLowerCase();
  if (String(item.signal_hash).toLowerCase() !== expected) {
    return c.json({ code: "INVALID", error: "The proof was made for a different wallet or role" }, 400);
  }

  const v = await fetch(`https://developer.world.org/api/v4/verify/${WORLD.rpId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...r, environment: WORLD.env }),
  });
  const body = await v.json().catch(() => ({}));
  if (!v.ok || body.success !== true) return c.json({ code: "INVALID", error: "World ID verification failed", detail: body }, 400);

  const nullifierHash = toHex(BigInt(item.nullifier), { size: 32 });
  const out = await attest(wallet, role, nullifierHash);
  if ("error" in out) {
    const msg = out.error === "ROLE_TAKEN" ? "This person already holds a Bull Street role" : "This wallet already has a role";
    return c.json({ code: out.error, error: msg }, 409);
  }
  return c.json(out);
});

/** Role registration without a scan: local chains, or when ALLOW_DEV_IDENTITY=true (ops use only). */
world.post("/dev", async (c) => {
  if (!ALLOW_DEV_IDENTITY) return c.json({ error: "Not available" }, 404);
  const { wallet, role, handle } = (await c.req.json()) as { wallet: Address; role: number; handle: string };
  if (!isAddress(wallet) || !handle || (role !== Role.Minter && role !== Role.Broker)) return c.json({ code: "INVALID", error: "Bad input" }, 400);
  const out = await attest(wallet, role, keccak256(toHex(`dev-identity:${handle.trim().toLowerCase()}`)));
  if ("error" in out) return c.json({ code: out.error, error: "This identity already holds a role" }, 409);
  return c.json(out);
});

world.get("/status/:wallet", async (c) => {
  const wallet = c.req.param("wallet") as Address;
  if (!isAddress(wallet)) return c.json({ error: "Bad address" }, 400);
  const role = await publicClient.readContract({ address: deployment().roles, abi: roleRegistryAbi, functionName: "roleOf", args: [wallet] });
  return c.json({ wallet, role: Number(role) });
});
