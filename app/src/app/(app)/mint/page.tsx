"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { maxUint256, type Address } from "viem";
import {
  AllocStatus,
  LEVEL_LABEL,
  PLEDGE_STATUS_LABEL,
  PledgeStatus,
  Role,
  TIER_LABEL,
  assetById,
  mockUsdcAbi,
  pledgeRegistryAbi,
  redemptionEngineAbi,
} from "@bullstreet/shared";
import { AssetTabs } from "@/components/AssetSelect";
import { RoleGate } from "@/components/RoleGate";
import {
  AmountInput,
  AssetMark,
  Button,
  DepositoryLabel,
  Empty,
  ExternalLink,
  Field,
  Note,
  PageHeader,
  Panel,
  Segmented,
  Skeleton,
  Stat,
  StatusPill,
  TxStatus,
  assetOf,
  units,
  usd,
} from "@/components/ui";
import { api } from "@/lib/api";
import { until, useAllowanceCheck, useDeployment, useNow, useSnapshot, useTx } from "@/lib/hooks";
import type { AllocationView, PledgeView, Snapshot } from "@/lib/types";
import { useActiveAccount } from "@/lib/wallet";

const ONE = 10n ** 18n;
const shares = (u: string | bigint) => BigInt(u) / ONE;

interface DepPledge {
  psn: string;
  status: string;
  qty: number;
  guided: number;
}
interface DepAccount {
  account: { bo_id: string; name: string };
  holdings: { isin: string; free: number; pledged: number }[];
}

function useDepAccounts() {
  const { address } = useActiveAccount();
  return useQuery({ queryKey: ["dep", address], enabled: !!address, queryFn: () => api<DepAccount[]>(`/dep/wallet/${address}`), refetchInterval: 8000 });
}

// ---------------------------------------------------------------- redemptions to act on

function Duties({ s }: { s: Snapshot }) {
  const { data: d } = useDeployment();
  const { address } = useActiveAccount();
  const tx = useTx();
  const allowed = useAllowanceCheck();
  const now = useNow();
  const mine = new Set(s.pledges.filter((p) => p.minter.toLowerCase() === address?.toLowerCase()).map((p) => p.id));
  const duties = (s.user?.duties ?? []).filter((a) => mine.has(a.pledgeId) && (a.status === AllocStatus.Assigned || a.status === AllocStatus.CurePending));
  if (!duties.length || !d) return null;
  const cure = async (a: AllocationView) => {
    const asset = s.assets.find((x) => x.id === a.assetId)!;
    const escrow = (BigInt(a.units) * BigInt(asset.close) * BigInt(s.params.CURE_ESCROW_BPS ?? "12000")) / ONE / 10_000n;
    const reqs = [];
    if (!(await allowed(d.usdc, address as Address, d.redemption, escrow))) {
      reqs.push({ address: d.usdc, abi: mockUsdcAbi, functionName: "approve", args: [d.redemption, maxUint256] });
    }
    reqs.push({ address: d.redemption, abi: redemptionEngineAbi, functionName: "cure", args: [BigInt(a.id)] });
    await tx.send(`cure ${a.id}`, ...reqs);
  };
  return (
    <Panel
      title="Redemptions on your pledges"
      description="Pay the holder before the cure deadline to keep your shares. Otherwise your broker sells them on NSE at the next session."
      flush
    >
      <table>
        <thead>
          <tr>
            <th>Pledge</th>
            <th className="r">Tokens</th>
            <th>Priced at</th>
            <th>Cure deadline</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {duties.map((a) => {
            const asset = s.assets.find((x) => x.id === a.assetId)!;
            const open = a.status === AllocStatus.Assigned && now < a.cureDeadline;
            const escrow = (BigInt(a.units) * BigInt(asset.close) * BigInt(s.params.CURE_ESCROW_BPS ?? "12000")) / ONE / 10_000n;
            return (
              <tr key={a.id}>
                <td>
                  #{a.pledgeId} · {asset.symbol}
                </td>
                <td className="r num">{units(a.units)}</td>
                <td className="text-[13px]">
                  {BigInt(a.refClose) > 0n ? <span className="num">{usd(a.refClose)} close</span> : `session ${a.refSession} close`}
                </td>
                <td className="text-[13px]">{a.status === AllocStatus.CurePending ? "Paid, settling at the close" : open ? `in ${until(a.cureDeadline, now)}` : "Passed"}</td>
                <td className="r">
                  {open && (
                    <Button size="sm" onClick={() => cure(a)} loading={tx.pending === `cure ${a.id}`} title={`Escrows ${usd(escrow)} now; the unused part is refunded`}>
                      Pay and keep shares
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-5 py-3">
        <p className="text-[12.5px] text-muted">
          Paying escrows 120% of the last close; at the next close you pay the exact value and get the rest back.
        </p>
        <TxStatus pending={tx.pending} error={tx.error} />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- demat account

function DematAccount() {
  const { address } = useActiveAccount();
  const { data: accounts, isLoading } = useDepAccounts();
  const qc = useQueryClient();
  const [boId, setBoId] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const link = async () => {
    setErr(null);
    setBusy(true);
    try {
      await api("/dep/accounts", { body: { boId, wallet: address, name } });
      await qc.invalidateQueries({ queryKey: ["dep"] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (isLoading) return <Skeleton className="h-40 w-full rounded-2xl" />;
  const acc = accounts?.[0];
  if (!acc) {
    return (
      <Panel title="Connect your demat account" description="Bull Street reads your CDSL holdings and pledges from the shares you choose, directly from your account.">
        <div className="flex flex-col gap-3">
          <Field label="CDSL BO ID" hint="16 digits, shown in your broker's app or CDSL statement">
            <input value={boId} onChange={(e) => setBoId(e.target.value.replace(/\D/g, "").slice(0, 16))} placeholder="1208160000000000" inputMode="numeric" />
          </Field>
          <Field label="Account name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </Field>
          <Button onClick={link} disabled={boId.length !== 16 || busy} loading={busy}>
            Connect account
          </Button>
          <TxStatus pending={null} error={err} />
        </div>
      </Panel>
    );
  }
  return (
    <Panel title="Demat account" description={`${acc.account.name} · CDSL ${acc.account.bo_id}`} flush>
      <table>
        <thead>
          <tr>
            <th>Stock</th>
            <th className="r">Free</th>
            <th className="r">Pledged</th>
          </tr>
        </thead>
        <tbody>
          {acc.holdings.map((h) => {
            const a = assetOfIsin(h.isin);
            return (
              <tr key={h.isin}>
                <td>
                  <span className="flex items-center gap-2">
                    {a && <AssetMark assetId={a.id} size={24} />}
                    <span className="font-medium">{a?.ticker ?? h.isin}</span>
                  </span>
                </td>
                <td className="r num">{h.free}</td>
                <td className="r num">{h.pledged}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

function assetOfIsin(isin: string) {
  return [1, 2, 3].map((id) => assetById(id)!).find((a) => a.isin === isin);
}

// ---------------------------------------------------------------- new pledge

interface Shard {
  broker: Address;
  name: string;
  tier: number;
  shares: number;
  value: number;
}

function NewPledge({ s }: { s: Snapshot }) {
  const { data: d } = useDeployment();
  const { address } = useActiveAccount();
  const client = usePublicClient();
  const { data: accounts } = useDepAccounts();
  const qc = useQueryClient();
  const tx = useTx();
  const [assetId, setAssetId] = useState(1);
  const [qty, setQty] = useState("");
  const [method, setMethod] = useState<"connected" | "guided">("connected");
  const [plan, setPlan] = useState<Shard[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const acc = accounts?.[0];
  const asset = s.assets.find((a) => a.id === assetId)!;
  const free = acc?.holdings.find((h) => h.isin === asset.isin)?.free ?? 0;

  const makePlan = async () => {
    setErr(null);
    setPlan(null);
    try {
      const r = await api<{ shards: Shard[] }>("/plan/pledge", { body: { assetId, shares: Number(qty) } });
      setPlan(r.shards);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const execute = async () => {
    if (!d || !plan || !client || !address) return;
    setErr(null);
    setDone(null);
    let made = 0;
    for (const sh of plan) {
      const ok = await tx.send(`Opening pledge to ${sh.name}`, {
        address: d.pledges,
        abi: pledgeRegistryAbi,
        functionName: "openPledge",
        args: [assetId, BigInt(sh.shares), sh.broker, method === "guided"],
      });
      if (!ok) return;
      const ids = (await client.readContract({ address: d.pledges, abi: pledgeRegistryAbi, functionName: "pledgesOf", args: [address] })) as bigint[];
      const id = ids[ids.length - 1];
      if (method === "connected") {
        try {
          await api("/dep/pledge", { body: { pledgeId: id.toString(), boId: acc!.account.bo_id } });
        } catch (e) {
          setErr(`Pledge #${id} opened, but the depository request failed: ${(e as Error).message}`);
          return;
        }
      }
      made++;
    }
    setDone(
      method === "connected"
        ? `${made} pledge${made > 1 ? "s" : ""} sent to CDSL. Your broker confirms them on-chain, then you can mint.`
        : `${made} pledge${made > 1 ? "s" : ""} opened. Complete ${made > 1 ? "each" : "it"} in CDSL Easiest below.`,
    );
    setPlan(null);
    setQty("");
    await qc.invalidateQueries({ queryKey: ["dep"] });
  };

  return (
    <Panel title="New pledge" description="Your shares stay in your demat account, pledged to a bonded broker.">
      <div className="flex flex-col gap-4">
        <AssetTabs value={assetId} onChange={(id) => (setAssetId(id), setPlan(null))} />
        <Field label="Shares to pledge" hint={acc ? `${free} ${asset.ticker} free in your account` : undefined}>
          <AmountInput value={qty} onChange={(v) => (setQty(v), setPlan(null))} unit={asset.ticker} integer />
        </Field>
        <Field label="Pledge from">
          <Segmented
            value={method}
            onChange={(m) => setMethod(m)}
            options={[
              ["connected", "Connected account"],
              ["guided", "CDSL Easiest"],
            ]}
          />
        </Field>
        {method === "connected" && !acc && <Note tone="warn">Connect your demat account first.</Note>}
        {method === "guided" && (
          <p className="text-[12.5px] leading-snug text-muted">
            You will create the pledge yourself in CDSL Easiest with the values we give you, then paste the pledge sequence number.
          </p>
        )}
        {!plan ? (
          <Button onClick={makePlan} disabled={!Number(qty) || (method === "connected" && (!acc || Number(qty) > free))}>
            Find brokers
          </Button>
        ) : (
          <>
            <div className="rounded-xl bg-soft px-4 py-3">
              <p className="text-[12.5px] font-medium text-body">
                {plan.length > 1 ? `Split across ${plan.length} brokers to fit their limits` : "One pledge"}
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {plan.map((sh) => (
                  <li key={sh.broker} className="flex items-center justify-between text-[13px]">
                    <span>
                      {sh.name} <span className="text-muted">· {TIER_LABEL[sh.tier]}</span>
                    </span>
                    <span className="num">
                      {sh.shares} · {usd(BigInt(Math.round(sh.value * 1e6)))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setPlan(null)}>
                Change
              </Button>
              <Button className="flex-1" onClick={execute} loading={!!tx.pending}>
                Pledge {Number(qty)} {asset.ticker}
              </Button>
            </div>
          </>
        )}
        <TxStatus pending={tx.pending} error={err ?? tx.error} success={done} />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- pledge card

function Guided({ p }: { p: PledgeView }) {
  const { data: accounts } = useDepAccounts();
  const qc = useQueryClient();
  const { data: g } = useQuery({ queryKey: ["guided", p.id], queryFn: () => api<any>(`/dep/guided/${p.id}`) });
  const [psn, setPsn] = useState("");
  const [boId, setBoId] = useState(accounts?.[0]?.account.bo_id ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  if (!g) return <Skeleton className="h-24 w-full" />;
  const submit = async () => {
    setErr(null);
    try {
      await api(`/dep/guided/${p.id}`, { body: { boId, psn } });
      setOk("Sent to your broker to confirm against their CDSL account.");
      await qc.invalidateQueries({ queryKey: ["depPledge", p.id] });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="rounded-xl border border-line px-4 py-4">
      <p className="text-[13px] font-semibold text-ink">Complete this pledge in CDSL Easiest</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-snug text-body">
        {g.steps.map((x: string) => (
          <li key={x}>{x}</li>
        ))}
      </ol>
      <div className="mt-3">
        <ExternalLink href={g.url}>Open CDSL Easiest</ExternalLink>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Your BO ID">
          <input value={boId} onChange={(e) => setBoId(e.target.value.replace(/\D/g, "").slice(0, 16))} inputMode="numeric" />
        </Field>
        <Field label="Pledge sequence number">
          <input value={psn} onChange={(e) => setPsn(e.target.value.trim())} placeholder="PSN…" />
        </Field>
        <Button onClick={submit} disabled={boId.length !== 16 || psn.length < 6}>
          Submit
        </Button>
      </div>
      <TxStatus pending={null} error={err} success={ok} />
    </div>
  );
}

function PledgeCard({ p, s, siblings }: { p: PledgeView; s: Snapshot; siblings: PledgeView[] }) {
  const { data: d } = useDeployment();
  const { address } = useActiveAccount();
  const tx = useTx();
  const allowed = useAllowanceCheck();
  const now = useNow();
  const [action, setAction] = useState<"mint" | "burn" | "release" | "migrate">("mint");
  const [amount, setAmount] = useState("");
  const [target, setTarget] = useState("");
  const { data: dep } = useQuery({
    queryKey: ["depPledge", p.id],
    queryFn: () => api<DepPledge>(`/dep/agreement/${p.id}`).catch(() => null),
    refetchInterval: p.status === PledgeStatus.Pending ? 5000 : 30000,
  });
  const asset = s.assets.find((a) => a.id === p.assetId)!;
  const broker = s.brokers.find((b) => b.address.toLowerCase() === p.broker.toLowerCase());
  const q = BigInt(p.q);
  const m = BigInt(p.m);
  const a = BigInt(p.a);
  const free = m - a;
  const spare = q - m - BigInt(p.pendingRelease);
  const balance = BigInt(s.user?.balances[p.assetId] ?? 0);
  const n = BigInt(amount || 0);
  const active = p.status === PledgeStatus.Active;
  const attested = active && p.attestedUntil > now;
  const releaseOverdue = BigInt(p.pendingRelease) > 0n && now > p.releaseDeadline && !p.releasePenaltyPaid;
  const mintFee = (n * BigInt(asset.close) * BigInt(s.params.MINT_FEE_BPS ?? "10")) / 10_000n;

  const run = async () => {
    if (!d) return;
    if (action === "mint") {
      const reqs = [];
      if (mintFee > 0n && !(await allowed(d.usdc, address as Address, d.pledges, mintFee))) {
        reqs.push({ address: d.usdc, abi: mockUsdcAbi, functionName: "approve", args: [d.pledges, maxUint256] });
      }
      reqs.push({ address: d.pledges, abi: pledgeRegistryAbi, functionName: "mint", args: [BigInt(p.id), n] });
      if (await tx.send("Minting", ...reqs)) setAmount("");
    } else if (action === "burn") {
      if (await tx.send("Burning", { address: d.pledges, abi: pledgeRegistryAbi, functionName: "burnAgainst", args: [BigInt(p.id), n * ONE] })) setAmount("");
    } else if (action === "release") {
      if (await tx.send("Requesting release", { address: d.pledges, abi: pledgeRegistryAbi, functionName: "requestRelease", args: [BigInt(p.id), n] })) setAmount("");
    } else {
      if (await tx.send("Moving backing", { address: d.pledges, abi: pledgeRegistryAbi, functionName: "migrate", args: [BigInt(p.id), BigInt(target), n * ONE] })) setAmount("");
    }
  };

  const max = action === "mint" ? spare / ONE : action === "burn" ? (free < balance ? free : balance) / ONE : action === "release" ? spare / ONE : free / ONE;
  const targets = siblings.filter((x) => x.id !== p.id && x.assetId === p.assetId && x.status === PledgeStatus.Active);

  return (
    <article className="rounded-2xl border border-line bg-canvas">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <AssetMark assetId={p.assetId} />
          <div>
            <div className="text-[15px] font-semibold text-ink">
              Pledge #{p.id} · {shares(q).toString()} {asset.ticker}
            </div>
            <div className="text-[12.5px] text-muted">
              {broker?.name ?? "Broker"} · {TIER_LABEL[p.tier]}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {active && <StatusPill tone={p.level === 2 ? "accent" : p.level === 3 || p.level === 1 ? "warn" : "neutral"}>{LEVEL_LABEL[p.level]}</StatusPill>}
          <StatusPill tone={active ? "up" : p.status === PledgeStatus.Pending ? "warn" : "neutral"}>{PLEDGE_STATUS_LABEL[p.status]}</StatusPill>
        </div>
      </header>

      <div className="px-5 py-4">
        <div className="flex h-2 overflow-hidden rounded-full bg-strong" aria-label="Pledged shares: assigned, minted and spare">
          <span className="bg-warn" style={{ width: `${q ? Number((a * 1000n) / q) / 10 : 0}%` }} title="Assigned to redemptions" />
          <span className="bg-accent" style={{ width: `${q ? Number((free * 1000n) / q) / 10 : 0}%` }} title="Minted" />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Pledged" value={units(q, 0)} />
          <Stat label="Minted" value={units(m, 0)} />
          <Stat label="Being redeemed" value={units(a, 0)} tone={a > 0n ? "warn" : undefined} />
          <Stat label="Free to mint" value={units(spare > 0n ? spare : 0n, 0)} />
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-body">
          <DepositoryLabel guided={p.guided} />
          {dep && <span className="num text-muted">{dep.psn}</span>}
          {active && <span>{attested ? `Attested for ${until(p.attestedUntil, now)}` : "Attestation expired"}</span>}
          {BigInt(p.pendingRelease) > 0n && (
            <span className="text-warn">
              Release of {units(p.pendingRelease, 0)} pending{now > p.releaseDeadline ? " (overdue)" : ` · due in ${until(p.releaseDeadline, now)}`}
            </span>
          )}
        </div>
      </div>

      {p.status === PledgeStatus.Pending && (
        <div className="border-t border-line px-5 py-4">
          {p.guided && (!dep || dep.status === "REPORTED") ? (
            dep ? <Note>Your broker is checking pledge {dep.psn} in their CDSL account.</Note> : <Guided p={p} />
          ) : (
            <Note>
              {dep?.status === "ACCEPTED"
                ? "CDSL accepted the pledge. Waiting for your broker's on-chain confirmation."
                : "CDSL is processing the pledge request. Requests made outside business days are processed on the next one."}
            </Note>
          )}
          <div className="mt-3">
            <Button
              size="sm"
              variant="ghost"
              loading={tx.pending === "Cancelling"}
              onClick={() => d && tx.send("Cancelling", { address: d.pledges, abi: pledgeRegistryAbi, functionName: "cancelPending", args: [BigInt(p.id)] })}
            >
              Cancel pledge
            </Button>
          </div>
        </div>
      )}

      {active && (
        <div className="border-t border-line px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              size="sm"
              value={action}
              onChange={(v) => (setAction(v), setAmount(""))}
              options={[
                ["mint", "Mint"],
                ["burn", "Burn"],
                ["release", "Release"],
                ...(targets.length ? ([["migrate", "Move"]] as const) : []),
              ]}
            />
            <label className="flex items-center gap-2 text-[13px] text-body">
              <input
                type="checkbox"
                className="!h-4 !w-4 accent-[var(--color-accent)]"
                checked={p.volunteer}
                onChange={() =>
                  d && tx.send("Updating", { address: d.pledges, abi: pledgeRegistryAbi, functionName: "setVolunteer", args: [BigInt(p.id), !p.volunteer] })
                }
              />
              Volunteer for redemptions (fee rebate)
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            {action === "migrate" && (
              <Field label="To pledge" className="w-40">
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">Choose</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      #{t.id}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field
              className="min-w-40 flex-1"
              label={action === "mint" ? "Tokens to mint" : action === "burn" ? "Tokens to burn" : action === "release" ? "Shares to release" : "Tokens to move"}
              hint={`Up to ${max.toString()}${action === "mint" && n > 0n ? ` · fee ${usd(mintFee, 4)}` : ""}`}
            >
              <AmountInput value={amount} onChange={setAmount} integer unit={action === "release" ? asset.ticker : asset.symbol} />
            </Field>
            <Button
              onClick={run}
              disabled={n === 0n || n > max || (action === "mint" && !attested) || (action === "migrate" && !target)}
              loading={!!tx.pending}
            >
              {action === "mint" ? "Mint" : action === "burn" ? "Burn" : action === "release" ? "Request release" : "Move"}
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {m > 0n && balance > 0n && (
              <Link
                href={`/trade?asset=${p.assetId}&side=sell${asset.asks[0] ? `&price=${asset.asks[0].price}` : `&price=${asset.close}`}`}
                className="inline-flex h-8 items-center rounded-full bg-strong px-3.5 text-[13px] font-semibold text-ink hover:bg-[#e2e5e9]"
              >
                List for sale
              </Link>
            )}
            {releaseOverdue && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => d && tx.send("Claiming penalty", { address: d.pledges, abi: pledgeRegistryAbi, functionName: "claimReleasePenalty", args: [BigInt(p.id)] })}
              >
                Claim late-release penalty
              </Button>
            )}
          </div>
          <TxStatus pending={tx.pending} error={tx.error} />
        </div>
      )}
    </article>
  );
}

function Workspace() {
  const { data: s } = useSnapshot();
  const { address } = useActiveAccount();
  if (!s) return <Skeleton className="h-96 w-full rounded-2xl" />;
  const mine = s.pledges.filter((p) => p.minter.toLowerCase() === address?.toLowerCase());
  const live = mine.filter((p) => p.status === PledgeStatus.Active || p.status === PledgeStatus.Pending);
  const past = mine.filter((p) => p.status !== PledgeStatus.Active && p.status !== PledgeStatus.Pending);
  const minted = mine.reduce((t, p) => t + BigInt(p.m), 0n);
  return (
    <div className="flex flex-col gap-6">
      <Duties s={s} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-6">
          <section className="grid grid-cols-2 gap-6 rounded-2xl border border-line bg-canvas p-5 sm:grid-cols-4">
            <Stat label="Live pledges" value={live.length} />
            <Stat label="Tokens minted" value={units(minted, 0)} />
            <Stat label="USDC" value={usd(s.user?.usdc ?? 0)} />
            <Stat label="Fee on mint" value={`${(Number(s.params.MINT_FEE_BPS ?? 10) / 100).toFixed(2)}%`} sub="half goes to your broker" />
          </section>
          {!live.length ? (
            <Panel>
              <Empty title="No pledges yet">
                Pledge shares from your demat account to a bonded broker. Once the broker confirms, you can mint one token per share at any hour.
              </Empty>
            </Panel>
          ) : (
            live.map((p) => <PledgeCard key={p.id} p={p} s={s} siblings={mine} />)
          )}
          {past.length > 0 && (
            <Panel title="Closed pledges" flush>
              <table>
                <tbody>
                  {past.map((p) => (
                    <tr key={p.id}>
                      <td>#{p.id}</td>
                      <td>{assetOf(p.assetId)?.ticker}</td>
                      <td>{PLEDGE_STATUS_LABEL[p.status]}</td>
                      <td className="r num text-muted">
                        {units(p.invoked, 0)} sold · {units(p.cured, 0)} paid by you · {units(p.released, 0)} released
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
        <aside className="flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
          <NewPledge s={s} />
          <DematAccount />
        </aside>
      </div>
    </div>
  );
}

export default function MintPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Mint"
        description="Pledge shares you own to a bonded broker, then mint one token per share at any hour. Your shares never leave your demat account."
      />
      <RoleGate role={Role.Minter}>
        <Workspace />
      </RoleGate>
    </div>
  );
}
