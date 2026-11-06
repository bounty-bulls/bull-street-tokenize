"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWalletClient } from "wagmi";
import { keccak256, maxUint256, parseUnits, toHex, zeroAddress, type Address } from "viem";
import {
  AllocStatus,
  BROKER_STATUS_LABEL,
  BrokerStatus,
  PledgeStatus,
  Role,
  TIER_LABEL,
  assetById,
  bondVaultAbi,
  brokerRegistryAbi,
  domain,
  mockUsdcAbi,
  pledgeAttestationTypes,
  pledgeRegistryAbi,
  randomNonce,
  redemptionEngineAbi,
  releaseConfirmationTypes,
  saleReportTypes,
} from "@bullstreet/shared";
import { RoleGate } from "@/components/RoleGate";
import {
  Addr,
  AmountInput,
  Button,
  DepositoryLabel,
  Empty,
  Field,
  Note,
  PageHeader,
  Panel,
  RatioMeter,
  Segmented,
  Skeleton,
  Stat,
  StatusPill,
  TxStatus,
  units,
  usd,
} from "@/components/ui";
import { api } from "@/lib/api";
import { CHAIN_ID, IS_LOCAL } from "@/lib/config";
import { errorMessage, until, useAllowanceCheck, useDeployment, useNow, useSnapshot, useTx } from "@/lib/hooks";
import type { AllocationView, BrokerView, PledgeView, Snapshot } from "@/lib/types";
import { useActiveAccount } from "@/lib/wallet";

const ONE = 10n ** 18n;

interface DepPledge {
  psn: string;
  status: string;
  qty: number;
  invoked: number;
  released: number;
  guided: number;
}

const depMessage = (action: string, psn: string, qty: number, ts: number) =>
  `Bull Street depository\naction: ${action}\npsn: ${psn}\nqty: ${qty}\ntime: ${ts}`;

/** Signs (in the wallet) and sends a pledgee action to the depository. */
function useDepAction() {
  const { data: wallet } = useWalletClient();
  const { address } = useActiveAccount();
  return async (action: "confirm" | "invoke" | "release", psn: string, qty = 0) => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = IS_LOCAL ? undefined : await wallet!.signMessage({ message: depMessage(action, psn, qty, ts) });
    return api(`/dep/pledges/${psn}/${action}`, { body: { wallet: address, qty, ts, sig } });
  };
}

// ---------------------------------------------------------------- join

function Join() {
  const { data: d } = useDeployment();
  const { address } = useActiveAccount();
  const qc = useQueryClient();
  const tx = useTx();
  const [tier, setTier] = useState("0");
  const [boId, setBoId] = useState("");
  const [name, setName] = useState("");
  const [delegate, setDelegate] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const join = async () => {
    if (!d) return;
    setErr(null);
    const ok = await tx.send("Joining", {
      address: d.brokers,
      abi: brokerRegistryAbi,
      functionName: "join",
      args: [Number(tier), keccak256(toHex(boId)), (delegate || zeroAddress) as Address, name],
    });
    if (!ok) return;
    try {
      await api("/dep/brokers", { body: { wallet: address, boId, name } });
      await qc.invalidateQueries();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Panel title="Register as a pledge broker" description="Minters pledge shares to your CDSL account. You confirm pledges, sell shares for redemptions and keep a USDC bond.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Display name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your firm's name" />
        </Field>
        <Field label="Pledgee CDSL BO ID" hint="Stored on-chain only as a hash">
          <input value={boId} onChange={(e) => setBoId(e.target.value.replace(/\D/g, "").slice(0, 16))} inputMode="numeric" placeholder="16 digits" />
        </Field>
        <Field label="Tier" hint="The largest single pledge you accept. Each tier has a minimum bond.">
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="0">Tier 1 · retail</option>
            <option value="1">Tier 2 · standard</option>
            <option value="2">Tier 3 · large</option>
          </select>
        </Field>
        <Field label="Delegate key (optional)" hint="A hot key that may sign attestations and sale reports for you">
          <input value={delegate} onChange={(e) => setDelegate(e.target.value.trim())} placeholder="0x…" />
        </Field>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <Button onClick={join} disabled={!name || boId.length !== 16} loading={!!tx.pending}>
          Register
        </Button>
        <TxStatus pending={tx.pending} error={err ?? tx.error} />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- bond

function Bond({ b, s }: { b: BrokerView; s: Snapshot }) {
  const { data: d } = useDeployment();
  const { address } = useActiveAccount();
  const tx = useTx();
  const allowed = useAllowanceCheck();
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amt, setAmt] = useState("");
  const value = (() => {
    try {
      return amt ? parseUnits(amt, 6) : 0n;
    } catch {
      return 0n;
    }
  })();
  const minBond = BigInt(s.params[`MIN_BOND_${b.tier + 1}`] ?? 0);
  const withdrawable = BigInt(b.bond) - BigInt(b.required) > 0n ? BigInt(b.bond) - BigInt(b.required) : 0n;
  const go = async () => {
    if (!d) return;
    if (mode === "deposit") {
      const reqs = [];
      if (!(await allowed(d.usdc, address as Address, d.bondVault, value))) reqs.push({ address: d.usdc, abi: mockUsdcAbi, functionName: "approve", args: [d.bondVault, maxUint256] });
      reqs.push({ address: d.bondVault, abi: bondVaultAbi, functionName: "deposit", args: [value] });
      if (await tx.send("Depositing", ...reqs)) setAmt("");
    } else if (await tx.send("Withdrawing", { address: d.bondVault, abi: bondVaultAbi, functionName: "withdraw", args: [value] })) setAmt("");
  };
  return (
    <Panel title="Bond" description={`Minimum for ${TIER_LABEL[b.tier]}: ${usd(minBond, 0)}. Required now: ${usd(b.required)} (110% of pledged value, 125% over long closures).`}>
      <div className="flex flex-col gap-3">
        <Segmented
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            ["deposit", "Deposit"],
            ["withdraw", "Withdraw"],
          ]}
        />
        <Field label="Amount" hint={mode === "deposit" ? `Wallet: ${usd(s.user?.usdc ?? 0)}` : `Withdrawable: ${usd(withdrawable)}`}>
          <AmountInput value={amt} onChange={setAmt} unit="USDC" />
        </Field>
        <Button onClick={go} disabled={value === 0n} loading={!!tx.pending}>
          {mode === "deposit" ? "Deposit" : "Withdraw"}
        </Button>
        <TxStatus pending={tx.pending} error={tx.error} />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- incoming pledges

function useDepPledge(id: string) {
  return useQuery({ queryKey: ["depPledge", id], queryFn: () => api<DepPledge>(`/dep/agreement/${id}`).catch(() => null), refetchInterval: 6000 });
}

function IncomingRow({ p, s, automated }: { p: PledgeView; s: Snapshot; automated: boolean }) {
  const { data: d } = useDeployment();
  const { data: wallet } = useWalletClient();
  const { data: dep, refetch } = useDepPledge(p.id);
  const depAction = useDepAction();
  const tx = useTx();
  const [err, setErr] = useState<string | null>(null);
  const asset = assetById(p.assetId)!;
  const ttl = Number(s.params.ATTEST_TTL ?? 604800);

  const attest = async () => {
    if (!d || !dep || !wallet) return;
    setErr(null);
    try {
      if (dep.status === "REPORTED") {
        await depAction("confirm", dep.psn);
        await refetch();
      }
      const a = {
        pledgeId: BigInt(p.id),
        psnHash: keccak256(toHex(dep.psn)),
        isinHash: keccak256(toHex(asset.isin)),
        quantity: BigInt(p.q) / ONE,
        minter: p.minter,
        validUntil: BigInt(Math.floor(Date.now() / 1000) + ttl - 120),
        nonce: randomNonce(),
      };
      const sig = await wallet.signTypedData({ domain: domain(CHAIN_ID, d.pledges), types: pledgeAttestationTypes, primaryType: "PledgeAttestation", message: a });
      await tx.send("Attesting", { address: d.pledges, abi: pledgeRegistryAbi, functionName: "attestPledge", args: [a, sig] });
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <tr>
      <td>
        <div className="font-medium">#{p.id}</div>
        <Addr a={p.minter} />
      </td>
      <td className="r num">
        {units(p.q, 0)} {asset.ticker}
      </td>
      <td>
        <DepositoryLabel guided={p.guided} />
      </td>
      <td className="text-[13px]">
        {!dep ? "Not in your account yet" : dep.status === "REPORTED" ? `Owner reports ${dep.psn}` : dep.status === "ACCEPTED" ? `Accepted · ${dep.psn}` : dep.status}
      </td>
      <td className="r">
        {automated ? (
          <span className="text-[12.5px] text-muted">Your desk attests automatically</span>
        ) : (
          <Button size="sm" onClick={attest} disabled={!dep || (dep.status !== "ACCEPTED" && dep.status !== "REPORTED")} loading={!!tx.pending}>
            {dep?.status === "REPORTED" ? "Confirm and attest" : "Attest"}
          </Button>
        )}
        {(err || tx.error) && <div className="mt-1 text-[12px] text-down">{err ?? tx.error}</div>}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------- allocations to settle

function SettleRow({ al, s, automated }: { al: AllocationView; s: Snapshot; automated: boolean }) {
  const { data: d } = useDeployment();
  const { address } = useActiveAccount();
  const { data: wallet } = useWalletClient();
  const { data: dep } = useDepPledge(al.pledgeId);
  const depAction = useDepAction();
  const allowed = useAllowanceCheck();
  const tx = useTx();
  const now = useNow();
  const [gross, setGross] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const asset = s.assets.find((a) => a.id === al.assetId)!;
  const qty = Number(BigInt(al.units) / ONE);
  const refPosted = BigInt(al.refClose) > 0n;
  const suggested = refPosted ? (BigInt(al.refClose) * BigInt(qty)).toString() : "";
  const canSettle = now >= al.cureDeadline && refPosted && al.status === AllocStatus.Assigned;

  const settle = async () => {
    if (!d || !dep || !wallet) return;
    setErr(null);
    try {
      const value = parseUnits(gross || (Number(suggested) / 1e6).toFixed(6), 6);
      if (dep.invoked + dep.released < dep.qty && !dep.guided) {
        try {
          await depAction("invoke", dep.psn, qty);
        } catch (e) {
          if (!/exceeds/i.test((e as Error).message)) throw e;
        }
      }
      const r = { allocationId: BigInt(al.id), quantity: BigInt(qty), grossProceeds: value, saleTime: BigInt(Math.floor(Date.now() / 1000)), nonce: randomNonce() };
      const sig = await wallet.signTypedData({ domain: domain(CHAIN_ID, d.redemption), types: saleReportTypes, primaryType: "SaleReport", message: r });
      const reqs = [];
      if (!(await allowed(d.usdc, address as Address, d.redemption, value))) reqs.push({ address: d.usdc, abi: mockUsdcAbi, functionName: "approve", args: [d.redemption, maxUint256] });
      reqs.push({ address: d.redemption, abi: redemptionEngineAbi, functionName: "settle", args: [r, sig] });
      await tx.send("Settling", ...reqs);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <tr>
      <td>
        <div className="font-medium">#{al.id}</div>
        <div className="text-[12px] text-muted">pledge #{al.pledgeId}</div>
      </td>
      <td className="r num">
        {qty} {asset.ticker}
      </td>
      <td className="text-[13px]">
        {al.status === AllocStatus.CurePending
          ? "Minter is paying"
          : now < al.cureDeadline
            ? `Cure window: ${until(al.cureDeadline, now)}`
            : refPosted
              ? `Sell and settle · soft deadline ${until(al.softDeadline, now)}`
              : "Sell during this session; settle at the close"}
      </td>
      <td className="r num">{refPosted ? usd(al.refClose) : "–"}</td>
      <td className="r">
        {automated ? (
          <span className="text-[12.5px] text-muted">Your desk settles automatically</span>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <input
              className="!h-8 !w-28 !text-[13px]"
              placeholder={suggested ? (Number(suggested) / 1e6).toFixed(2) : "Proceeds"}
              value={gross}
              onChange={(e) => setGross(e.target.value.replace(/[^\d.]/g, ""))}
              aria-label="Sale proceeds in USDC"
            />
            <Button size="sm" onClick={settle} disabled={!canSettle} loading={!!tx.pending}>
              Settle
            </Button>
          </div>
        )}
        {(err || tx.error) && <div className="mt-1 text-[12px] text-down">{err ?? tx.error}</div>}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------- active pledges: reattest and releases

function ActiveRow({ p, s, automated }: { p: PledgeView; s: Snapshot; automated: boolean }) {
  const { data: d } = useDeployment();
  const { data: wallet } = useWalletClient();
  const { data: dep, refetch } = useDepPledge(p.id);
  const depAction = useDepAction();
  const tx = useTx();
  const now = useNow();
  const [err, setErr] = useState<string | null>(null);
  const asset = assetById(p.assetId)!;
  const ttl = Number(s.params.ATTEST_TTL ?? 604800);
  const pendingRelease = Number(BigInt(p.pendingRelease) / ONE);

  const reattest = async () => {
    if (!d || !dep || !wallet) return;
    setErr(null);
    try {
      const a = {
        pledgeId: BigInt(p.id),
        psnHash: keccak256(toHex(dep.psn)),
        isinHash: keccak256(toHex(asset.isin)),
        quantity: BigInt(dep.qty - dep.invoked - dep.released),
        minter: p.minter,
        validUntil: BigInt(Math.floor(Date.now() / 1000) + ttl - 120),
        nonce: randomNonce(),
      };
      const sig = await wallet.signTypedData({ domain: domain(CHAIN_ID, d.pledges), types: pledgeAttestationTypes, primaryType: "PledgeAttestation", message: a });
      await tx.send("Re-attesting", { address: d.pledges, abi: pledgeRegistryAbi, functionName: "reattest", args: [a, sig] });
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  const confirmRelease = async () => {
    if (!d || !dep || !wallet) return;
    setErr(null);
    try {
      if (!dep.guided) await depAction("release", dep.psn, pendingRelease);
      await refetch();
      const c = { pledgeId: BigInt(p.id), quantity: BigInt(pendingRelease), nonce: randomNonce() };
      const sig = await wallet.signTypedData({ domain: domain(CHAIN_ID, d.pledges), types: releaseConfirmationTypes, primaryType: "ReleaseConfirmation", message: c });
      await tx.send("Confirming release", { address: d.pledges, abi: pledgeRegistryAbi, functionName: "confirmRelease", args: [c, sig] });
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <tr>
      <td>
        <div className="font-medium">#{p.id}</div>
        <Addr a={p.minter} />
      </td>
      <td className="r num">
        {units(p.q, 0)} {asset.ticker}
      </td>
      <td className="r num">{units(p.m, 0)}</td>
      <td className="text-[13px]">{p.attestedUntil > now ? `in ${until(p.attestedUntil, now)}` : <span className="text-down">expired</span>}</td>
      <td className="text-[13px]">{pendingRelease > 0 ? <span className="text-warn">Release {pendingRelease} · {now > p.releaseDeadline ? "overdue" : `due in ${until(p.releaseDeadline, now)}`}</span> : "–"}</td>
      <td className="r">
        {!automated && (
          <div className="flex justify-end gap-2">
            {pendingRelease > 0 && (
              <Button size="sm" onClick={confirmRelease} loading={tx.pending === "Confirming release"}>
                Release
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={reattest} loading={tx.pending === "Re-attesting"}>
              Re-attest
            </Button>
          </div>
        )}
        {(err || tx.error) && <div className="mt-1 text-[12px] text-down">{err ?? tx.error}</div>}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------- console

function Console({ s, b }: { s: Snapshot; b: BrokerView }) {
  const { data: d } = useDeployment();
  const tx = useTx();
  const [delegate, setDelegate] = useState("");
  const automated = b.delegate !== zeroAddress;
  const mine = s.pledges.filter((p) => p.broker.toLowerCase() === b.address.toLowerCase());
  const incoming = mine.filter((p) => p.status === PledgeStatus.Pending);
  const active = mine.filter((p) => p.status === PledgeStatus.Active);
  const pledgeIds = new Set(mine.map((p) => p.id));
  const toSettle = (s.user?.duties ?? []).filter((a) => pledgeIds.has(a.pledgeId) && (a.status === AllocStatus.Assigned || a.status === AllocStatus.CurePending));
  const health = b.health === null ? null : Number(b.health) / 100;
  const left = BigInt(b.capacity) - BigInt(b.exposure);
  const statusTone = b.status === BrokerStatus.Active ? "up" : b.status === BrokerStatus.Defaulted ? "down" : "warn";

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-line bg-canvas p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[18px] font-semibold text-ink">{b.name}</div>
            <div className="text-[13px] text-muted">
              {TIER_LABEL[b.tier]} · CDSL {b.boId ?? "not published"} {automated && <>· desk key <Addr a={b.delegate} /></>}
            </div>
          </div>
          <StatusPill tone={statusTone}>{BROKER_STATUS_LABEL[b.status]}</StatusPill>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat label="Bond" value={usd(b.bond, 0)} />
          <Stat label="Pledged value" value={usd(b.exposure, 0)} sub={`${b.pledgeCount} pledges`} />
          <Stat label="Capacity left" value={usd(left > 0n ? left : 0n, 0)} />
          <div>
            <Stat label="Coverage" value={health === null ? "–" : `${health.toFixed(0)}%`} tone={health !== null && health < 100 ? "down" : undefined} />
            {health !== null && <RatioMeter className="mt-2" value={health} required={100} />}
          </div>
        </div>
        {b.status === BrokerStatus.Pending && <Note tone="warn">Deposit at least the tier's minimum bond to start accepting pledges.</Note>}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          <Panel title="Redemptions to settle" description="After the minter's cure window, invoke and sell the shares on NSE, then settle at or above 99% of the session's close." flush>
            {!toSettle.length ? (
              <Empty title="Nothing to settle">Redemptions assigned to your pledges appear here with their deadlines.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Allocation</th>
                    <th className="r">Shares</th>
                    <th>Next step</th>
                    <th className="r">Close</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {toSettle.map((al) => (
                    <SettleRow key={al.id} al={al} s={s} automated={automated} />
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Pledges to confirm" description="Check each pledge in your CDSL account, then attest to it on-chain." flush>
            {!incoming.length ? (
              <Empty title="No pledges waiting">New pledges to your account appear here.</Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Pledge</th>
                    <th className="r">Shares</th>
                    <th>Source</th>
                    <th>CDSL</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {incoming.map((p) => (
                    <IncomingRow key={p.id} p={p} s={s} automated={automated && !p.guided} />
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Active pledges" description="Re-attest before an attestation runs out; pledges close to expiry move up the redemption queue." flush>
            {!active.length ? (
              <Empty title="No active pledges" />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Pledge</th>
                    <th className="r">Pledged</th>
                    <th className="r">Minted</th>
                    <th>Attested</th>
                    <th>Release</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {active.map((p) => (
                    <ActiveRow key={p.id} p={p} s={s} automated={automated && !p.guided} />
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <aside className="flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
          <Bond b={b} s={s} />
          <Panel title="Settings">
            <div className="flex flex-col gap-3">
              <Field label="Desk key" hint="Lets automation sign attestations and sale reports for you">
                <input value={delegate} onChange={(e) => setDelegate(e.target.value.trim())} placeholder={b.delegate !== zeroAddress ? b.delegate : "0x…"} />
              </Field>
              <Button
                variant="secondary"
                disabled={!/^0x[0-9a-fA-F]{40}$/.test(delegate)}
                onClick={() => d && tx.send("Saving", { address: d.brokers, abi: brokerRegistryAbi, functionName: "setDelegate", args: [delegate as Address] })}
              >
                Save desk key
              </Button>
              {(b.status === BrokerStatus.Active || b.status === BrokerStatus.Pending) && (
                <Button
                  variant="ghost"
                  onClick={() => d && tx.send("Draining", { address: d.brokers, abi: brokerRegistryAbi, functionName: "setDraining" })}
                >
                  Stop taking pledges
                </Button>
              )}
              {b.status === BrokerStatus.Draining && BigInt(b.exposure) === 0n && (
                <Button variant="ghost" onClick={() => d && tx.send("Exiting", { address: d.brokers, abi: brokerRegistryAbi, functionName: "exit" })}>
                  Exit and free the bond
                </Button>
              )}
              <TxStatus pending={tx.pending} error={tx.error} />
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function Workspace() {
  const { data: s } = useSnapshot();
  const { address } = useActiveAccount();
  if (!s) return <Skeleton className="h-96 w-full rounded-2xl" />;
  const b = s.brokers.find((x) => x.address.toLowerCase() === address?.toLowerCase());
  return b ? <Console s={s} b={b} /> : <Join />;
}

export default function BrokerPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Broker"
        description="Hold pledges in your CDSL account, confirm them on-chain, settle redemptions by selling on NSE, and earn half of the fees on your pledges."
      />
      <RoleGate role={Role.Broker}>
        <Workspace />
      </RoleGate>
    </div>
  );
}
