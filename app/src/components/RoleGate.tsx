"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { encodePacked, type Hex } from "viem";
import { IDKitRequestWidget, proofOfHuman, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { Fingerprint, UserRoundCheck, UserRoundX, Wallet } from "lucide-react";
import { Role, roleRegistryAbi } from "@bullstreet/shared";
import { IS_LOCAL, WORLD, WORLD_ENABLED } from "@/lib/config";
import { api } from "@/lib/api";
import { useDeployment, useSnapshot, useTx } from "@/lib/hooks";
import { useActiveAccount } from "@/lib/wallet";
import { Button, Field, Note, Skeleton, TxStatus } from "./ui";

interface Signed {
  attestation: { wallet: Hex; role: number; nullifierHash: Hex; expiry: string; nonce: string };
  signature: Hex;
}

function GateShell({ icon, title, children }: { icon: ReactNode; title: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-canvas px-6 py-10 sm:px-10">
      <div className="mx-auto flex max-w-[520px] flex-col items-center text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">{icon}</span>
        <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        <div className="mt-2 w-full text-[14px] leading-relaxed text-body">{children}</div>
      </div>
    </section>
  );
}

/**
 * One human, one role. World ID Proof of Human -> server verification -> EIP-712 role attestation ->
 * RoleRegistry.register. The alternative paths are shown too: cancelled, already holding a role, wrong wallet.
 */
export function RoleGate({ role, children }: { role: number; children: ReactNode }) {
  const { address, kind } = useActiveAccount();
  const { data: s } = useSnapshot();
  const { data: d } = useDeployment();
  const tx = useTx();
  const [open, setOpen] = useState(false);
  const [rp, setRp] = useState<RpContext | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [devIdentity, setDevIdentity] = useState(false);
  const [handle, setHandle] = useState("");
  const signedRef = useRef<Signed | null>(null);
  const roleName = role === Role.Minter ? "minter" : "broker";

  useEffect(() => {
    setDevIdentity(IS_LOCAL || new URLSearchParams(window.location.search).get("identity") === "dev");
  }, []);

  if (!address)
    return (
      <GateShell icon={<Wallet className="size-5" />} title="Connect your wallet">
        Connect a wallet to open the {roleName} workspace.
      </GateShell>
    );
  if (kind === "passkey")
    return (
      <GateShell icon={<Wallet className="size-5" />} title="Use a browser wallet for this workspace">
        Passkey wallets are for buying, selling and redeeming. Minters and brokers sign pledge and settlement messages, so
        they connect a browser wallet.
      </GateShell>
    );
  if (!s || !d) return <Skeleton className="h-64 w-full rounded-2xl" />;
  const current = s.user?.role ?? 0;
  if (current === role) return <>{children}</>;
  if (current !== Role.None) {
    return (
      <GateShell icon={<UserRoundCheck className="size-5" />} title={`This wallet is registered as a ${current === Role.Minter ? "minter" : "broker"}`}>
        Each verified person holds exactly one role, so no one can be both the minter and the broker of the same pledge. Switch
        to a wallet registered as a {roleName} to continue.
      </GateShell>
    );
  }
  if (taken) {
    return (
      <GateShell icon={<UserRoundX className="size-5" />} title="You already hold a Bull Street role">
        Your World ID is already registered to another wallet, as a minter or a broker. One person can hold one role, which keeps
        every pledge's minter and broker independent. Use the wallet you registered before.
      </GateShell>
    );
  }

  const register = async (signed: Signed) => {
    await tx.send(`Registering as ${roleName}`, {
      address: d.roles,
      abi: roleRegistryAbi,
      functionName: "register",
      args: [
        {
          wallet: signed.attestation.wallet,
          role: signed.attestation.role,
          nullifierHash: signed.attestation.nullifierHash,
          expiry: BigInt(signed.attestation.expiry),
          nonce: BigInt(signed.attestation.nonce),
        },
        signed.signature,
      ],
    });
  };

  const startWorld = async () => {
    setErr(null);
    setCancelled(false);
    try {
      const j = await api<any>("/world/rp-context", { method: "POST", body: {} });
      setRp({ rp_id: j.rp_id, nonce: j.nonce, created_at: j.created_at, expires_at: j.expires_at, signature: j.sig } as RpContext);
      setOpen(true);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const devRegister = async () => {
    setErr(null);
    try {
      await register(await api<Signed>("/world/dev", { body: { wallet: address, role, handle } }));
    } catch (e) {
      if ((e as any).code === "ROLE_TAKEN") setTaken(true);
      else setErr((e as Error).message);
    }
  };

  return (
    <GateShell icon={<Fingerprint className="size-5" />} title={`Verify to become a ${roleName}`}>
      <p>
        Bull Street uses World ID to confirm you are a unique person. One person can hold one role, which keeps minters and the
        brokers who hold their pledges independent. Only an anonymous identifier is stored on-chain.
      </p>
      <div className="mt-6 flex flex-col items-center gap-3">
        {WORLD_ENABLED ? (
          <Button size="lg" onClick={startWorld} loading={!!tx.pending}>
            Verify with World ID
          </Button>
        ) : (
          <p className="text-[13px] text-muted">Identity verification is unavailable on this deployment.</p>
        )}
        {rp && (
          <IDKitRequestWidget
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              if (!o && !signedRef.current) setCancelled(true);
            }}
            app_id={WORLD.appId as `app_${string}`}
            action={WORLD.action}
            rp_context={rp}
            allow_legacy_proofs={false}
            environment={WORLD.env}
            preset={proofOfHuman({ signal: encodePacked(["uint8", "address"], [role, address]) })}
            handleVerify={async (result: IDKitResult) => {
              try {
                signedRef.current = await api<Signed>("/world/verify", { body: { idkitResponse: result, wallet: address, role } });
              } catch (e) {
                if ((e as any).code === "ROLE_TAKEN") setTaken(true);
                throw e;
              }
            }}
            onSuccess={() => {
              if (signedRef.current) void register(signedRef.current);
            }}
            onError={(code) =>
              setErr(code === "max_verifications_reached" ? "This person already holds a Bull Street role." : `Verification failed (${code}).`)
            }
          />
        )}
        {cancelled && !err && <Note>Verification was cancelled. Nothing was shared. You can start again whenever you are ready.</Note>}
        {devIdentity && (
          <div className="mt-2 flex w-full max-w-[360px] items-end gap-2 text-left">
            <Field label="Identity handle" className="flex-1">
              <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="name" />
            </Field>
            <Button variant="ghost" onClick={devRegister} disabled={!handle || !!tx.pending}>
              Register
            </Button>
          </div>
        )}
        <TxStatus pending={tx.pending} error={err ?? tx.error} />
      </div>
    </GateShell>
  );
}
