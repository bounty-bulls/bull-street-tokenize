"use client";

import { useState } from "react";
import { maxUint256, type Address } from "viem";
import {
  ALLOC_STATUS_LABEL,
  AllocStatus,
  LEVEL_LABEL,
  OrderStatus,
  Side,
  TICKET_CLASS_LABEL,
  TICKET_STATUS_LABEL,
  TicketStatus,
  redemptionEngineAbi,
  stockTokenAbi,
} from "@bullstreet/shared";
import { AssetTabs } from "@/components/AssetSelect";
import {
  AmountInput,
  AssetMark,
  Button,
  Empty,
  Field,
  Note,
  PageHeader,
  Panel,
  Skeleton,
  StatusPill,
  TxStatus,
  assetOf,
  units,
  usd,
} from "@/components/ui";
import { api } from "@/lib/api";
import { until, useAllowanceCheck, useDeployment, useNow, useSnapshot, useTx } from "@/lib/hooks";
import type { AllocationView, Snapshot, TicketView } from "@/lib/types";
import { useActiveAccount } from "@/lib/wallet";

const ONE = 10n ** 18n;

interface PlanStep {
  level: number;
  pledgeId: string;
  units: string;
}

function Request({ s }: { s: Snapshot }) {
  const { data: d } = useDeployment();
  const { address } = useActiveAccount();
  const tx = useTx();
  const allowed = useAllowanceCheck();
  const [assetId, setAssetId] = useState(1);
  const [qty, setQty] = useState("");
  const [plan, setPlan] = useState<{ steps: PlanStep[]; hint: string[]; unplaced: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const a = s.assets.find((x) => x.id === assetId)!;
  const n = BigInt(qty || 0);
  const amount = n * ONE;
  const balance = BigInt(s.user?.balances[assetId] ?? 0);
  const inOrders = (s.user?.orders ?? [])
    .filter((o) => o.assetId === assetId && o.side === Side.Sell && o.status === OrderStatus.Open)
    .reduce((t, o) => t + BigInt(o.remaining), 0n);
  const small = n > 0n && n < BigInt(s.params.SMALL_MAX ?? "10");
  const fee = BigInt(s.params.REDEEM_FEE_BPS ?? "20");
  const estimate = (amount * BigInt(a.close)) / ONE;
  const next = s.calendar.next;

  const preview = async () => {
    setErr(null);
    try {
      setPlan(await api("/plan/allocation", { body: { assetId, shares: Number(qty) } }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const submit = async () => {
    if (!d || !address) return;
    setDone(null);
    const reqs = [];
    if (!(await allowed(a.token, address as Address, d.redemption, amount))) {
      reqs.push({ address: a.token, abi: stockTokenAbi, functionName: "approve", args: [d.redemption, maxUint256] });
    }
    const hint = !small && plan ? plan.hint.map((x) => BigInt(x)) : [];
    reqs.push({ address: d.redemption, abi: redemptionEngineAbi, functionName: "requestRedemption", args: [assetId, amount, hint] });
    if (await tx.send("Requesting redemption", ...reqs)) {
      setDone(small ? "Added to the next batch. You can claim your share once it settles." : "Redemption assigned. Follow it below.");
      setQty("");
      setPlan(null);
    }
  };

  return (
    <Panel title="Redeem for USDC" description="Hand tokens back and receive USDC at the next session's NSE close, less a 0.20% fee.">
      <div className="flex flex-col gap-4">
        <AssetTabs value={assetId} onChange={(id) => (setAssetId(id), setPlan(null))} />
        <Field label="Shares to redeem" hint={`You hold ${units(balance)} ${a.symbol}${inOrders > 0n ? ` (${units(inOrders)} more in open sell orders)` : ""}`}>
          <AmountInput value={qty} onChange={(v) => (setQty(v), setPlan(null))} integer unit={a.symbol} />
        </Field>
        <dl className="grid grid-cols-2 gap-y-2 rounded-xl bg-soft px-4 py-3 text-[13px]">
          <dt className="text-muted">Estimate at today&apos;s close</dt>
          <dd className="num text-right">{usd(estimate - (estimate * fee) / 10_000n)}</dd>
          <dt className="text-muted">Final price</dt>
          <dd className="text-right">{next ? `close of session ${small ? "after the batch" : next.index}` : "next session close"}</dd>
          <dt className="text-muted">Handling</dt>
          <dd className="text-right">{small ? "Batched with other small requests" : "Assigned now"}</dd>
        </dl>
        {plan && !small && (
          <div className="rounded-xl border border-line px-4 py-3">
            <p className="text-[12.5px] font-medium text-body">Where it will be paid from</p>
            <ul className="mt-2 flex flex-col gap-1.5 text-[13px]">
              {plan.steps.map((st, i) => (
                <li key={i} className="flex justify-between">
                  <span>{st.pledgeId === "0" ? "Reserve" : `${LEVEL_LABEL[st.level]} · pledge #${st.pledgeId}`}</span>
                  <span className="num">{units(st.units)}</span>
                </li>
              ))}
              {BigInt(plan.unplaced) > 0n && <li className="text-warn">{units(plan.unplaced)} waits for more backing to free up</li>}
            </ul>
          </div>
        )}
        {inOrders > 0n && n * ONE > balance && <Note tone="warn">Cancel your open sell orders first to redeem those tokens.</Note>}
        <div className="flex gap-2">
          {!small && (
            <Button variant="ghost" onClick={preview} disabled={n === 0n}>
              Preview
            </Button>
          )}
          <Button className="flex-1" onClick={submit} disabled={n === 0n || amount > balance} loading={!!tx.pending}>
            Redeem {n > 0n ? n.toString() : ""} {a.ticker}
          </Button>
        </div>
        <TxStatus pending={tx.pending} error={err ?? tx.error} success={done} />
      </div>
    </Panel>
  );
}

function pathLabel(al: AllocationView): string {
  if (al.pledgeId === "0") return "Reserve";
  return `Pledge #${al.pledgeId}`;
}

function AllocRow({ al, now }: { al: AllocationView; now: number }) {
  const { data: d } = useDeployment();
  const tx = useTx();
  const posted = BigInt(al.refClose) > 0n;
  const open = al.status === AllocStatus.Assigned || al.status === AllocStatus.CurePending;
  let next = "";
  if (al.status === AllocStatus.CurePending) next = posted ? "Ready to pay" : "Minter paid; settles at the close";
  else if (al.status === AllocStatus.Assigned) {
    if (al.pledgeId === "0") next = posted ? "Ready to pay" : `Pays at session ${al.refSession}'s close`;
    else if (now < al.cureDeadline) next = `Minter can pay for ${until(al.cureDeadline, now)}`;
    else if (now < al.softDeadline) next = `Broker settles within ${until(al.softDeadline, now)}`;
    else if (now < al.hardDeadline) next = `Late; bond pays after ${until(al.hardDeadline, now)}`;
    else next = "Bond pays now";
  }
  const act = (fn: string) => d && tx.send(fn, { address: d.redemption, abi: redemptionEngineAbi, functionName: fn, args: [BigInt(al.id)] });
  return (
    <tr>
      <td>{pathLabel(al)}</td>
      <td className="r num">{units(al.units)}</td>
      <td>
        <StatusPill tone={open ? "accent" : al.status === AllocStatus.Defaulted ? "warn" : "up"}>{ALLOC_STATUS_LABEL[al.status]}</StatusPill>
      </td>
      <td className="text-[13px]">{open ? next : `Paid ${usd(al.paid)}`}</td>
      <td className="r num">{posted ? usd(al.refClose) : "–"}</td>
      <td className="r">
        {al.status === AllocStatus.Assigned && al.pledgeId === "0" && posted && (
          <Button size="sm" onClick={() => act("claimReserve")} loading={!!tx.pending}>
            Claim
          </Button>
        )}
        {al.status === AllocStatus.CurePending && posted && (
          <Button size="sm" onClick={() => act("finalizeCure")} loading={!!tx.pending}>
            Claim
          </Button>
        )}
        {al.status === AllocStatus.Assigned && al.pledgeId !== "0" && now >= al.hardDeadline && (
          <Button size="sm" variant="danger" onClick={() => act("claimDefault")} loading={!!tx.pending}>
            Claim from bond
          </Button>
        )}
        {tx.error && <div className="mt-1 text-[12px] text-down">{tx.error}</div>}
      </td>
    </tr>
  );
}

function TicketCard({ t, now }: { t: TicketView; now: number }) {
  const { data: d } = useDeployment();
  const tx = useTx();
  const a = assetOf(t.assetId)!;
  const batchReady = t.batch?.processed && t.allocations.length > 0 && t.allocations.every((x) => x.status !== AllocStatus.Assigned && x.status !== AllocStatus.CurePending);
  return (
    <article className="rounded-2xl border border-line bg-canvas">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <AssetMark assetId={t.assetId} />
          <div>
            <div className="text-[15px] font-semibold text-ink">
              Redemption #{t.id} · {units(t.units)} {a.ticker}
            </div>
            <div className="text-[12.5px] text-muted">
              {TICKET_CLASS_LABEL[t.cls]} · requested {new Date(t.requestedAt * 1000).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {BigInt(t.paid) > 0n && <span className="num text-[14px] font-medium text-up">{usd(t.paid)} paid</span>}
          <StatusPill tone={t.status === TicketStatus.Done ? "up" : "accent"}>{TICKET_STATUS_LABEL[t.status]}</StatusPill>
        </div>
      </header>
      {t.batch && !t.batch.processed ? (
        <p className="px-5 py-4 text-[13px] text-body">
          Waiting for session {t.batch.session} to open, when this batch of {units(t.batch.units)} {a.ticker} is assigned. You receive your pro-rata
          share of the payout.
        </p>
      ) : !t.allocations.length ? (
        <p className="px-5 py-4 text-[13px] text-body">Waiting for free backing; the queue continues automatically.</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Paid from</th>
                <th className="r">Tokens</th>
                <th>Status</th>
                <th>Next</th>
                <th className="r">Close</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {t.allocations.map((al) => (
                <AllocRow key={al.id} al={al} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {t.batch && t.status === TicketStatus.Batched && batchReady && (
        <div className="border-t border-line px-5 py-3">
          <Button
            size="sm"
            onClick={() => d && tx.send("Claiming", { address: d.redemption, abi: redemptionEngineAbi, functionName: "claimBatch", args: [BigInt(t.id)] })}
            loading={!!tx.pending}
          >
            Claim your share
          </Button>
          <TxStatus pending={tx.pending} error={tx.error} />
        </div>
      )}
    </article>
  );
}

export default function RedeemPage() {
  const { data: s } = useSnapshot();
  const { address } = useActiveAccount();
  const now = useNow();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Redeem"
        description="Every token can be exchanged for USDC. The broker sells the pledged shares on NSE, the owner pays to keep them, or the broker's bond pays 105%."
      />
      {!s ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="flex flex-col gap-6">
            {!address ? (
              <Panel>
                <Empty title="Connect a wallet">Connect to redeem tokens and follow your redemptions.</Empty>
              </Panel>
            ) : !s.user?.tickets.length ? (
              <Panel>
                <Empty title="No redemptions yet">
                  Redemptions you request appear here with how they are being paid: by the minter, the broker&apos;s NSE sale, the reserve or a bond.
                </Empty>
              </Panel>
            ) : (
              s.user.tickets.map((t) => <TicketCard key={t.id} t={t} now={now} />)
            )}
          </div>
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <Request s={s} />
          </aside>
        </div>
      )}
    </div>
  );
}
