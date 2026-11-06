"use client";

import { useState } from "react";
import type { Address } from "viem";
import { ASSETS, assetFactoryAbi, complianceAbi, levelBookAbi, paramKey, paramsAbi, redemptionEngineAbi } from "@bullstreet/shared";
import { Addr, Button, Field, PageHeader, Panel, Skeleton, StatusPill, TxStatus, units, usd } from "@/components/ui";
import { ago, until, useDeployment, useNow, useSnapshot, useTx } from "@/lib/hooks";
import { useActiveAccount } from "@/lib/wallet";

const MONEY = /CAP|BOND_\d|MIN_ORDER/;
const TIME = /GRACE|TTL|WINDOW|CURE$|CLOSURE/;

function fmtParam(k: string, v: string) {
  if (MONEY.test(k)) return usd(v, 0);
  if (TIME.test(k)) {
    const s = Number(v);
    return s >= 86400 ? `${(s / 86400).toFixed(1)} d` : s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`;
  }
  if (/BPS/.test(k)) return `${(Number(v) / 100).toFixed(2)}%`;
  return v;
}

export default function OpsPage() {
  const { data: s } = useSnapshot();
  const { data: d } = useDeployment();
  const { address } = useActiveAccount();
  const tx = useTx();
  const now = useNow();
  const [deny, setDeny] = useState("");
  const [ca, setCa] = useState({ asset: "1", num: "2", den: "1" });
  const [param, setParam] = useState({ key: "SMALL_MAX", value: "" });
  if (!s || !d) return <Skeleton className="h-96 w-full rounded-2xl" />;
  const owner = address?.toLowerCase() === d.owner.toLowerCase();
  const call = (label: string, address: Address, abi: any, functionName: string, args: unknown[] = []) => tx.send(label, { address, abi, functionName, args });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Operations"
        description={`Calendar, prices, parameters and controls. Owner ${d.owner.slice(0, 10)}…${owner ? " (you)" : ""}; owner-only controls are disabled for other wallets.`}
      />
      <TxStatus pending={tx.pending} error={tx.error} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Sessions" description={`${s.calendar.mode === "compressed" ? "Compressed calendar" : "NSE calendar"} · ${s.calendar.count} sessions posted`} flush>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Opens</th>
                <th>Closes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.calendar.sessions.slice(0, 10).map((x) => (
                <tr key={x.index}>
                  <td className="num">{x.index}</td>
                  <td className="num text-[13px]">{new Date(x.open * 1000).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="num text-[13px]">{new Date(x.close * 1000).toLocaleTimeString("en-IN", { timeStyle: "short" })}</td>
                  <td className="text-[12.5px] text-muted">
                    {x.open <= now && now < x.close ? <StatusPill tone="up">Open</StatusPill> : x.close <= now ? "closed" : `in ${until(x.open, now)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Prices" description="Posted by the oracle signers (2 of 3) after each session closes." flush>
          <table>
            <thead>
              <tr>
                <th>Stock</th>
                <th className="r">Close</th>
                <th className="r">Session</th>
                <th>Posted</th>
              </tr>
            </thead>
            <tbody>
              {s.assets.map((a) => (
                <tr key={a.id}>
                  <td className="font-medium">{a.ticker}</td>
                  <td className="r num">{usd(a.close, 4)}</td>
                  <td className="r num">{a.closeSession}</td>
                  <td className="text-[13px]">{a.stale ? <span className="text-warn">awaiting latest close</span> : ago(a.asOf, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Trading controls" description="Pauses stop transfers, minting and trading; a corporate-action freeze also allows a split or bonus.">
          <div className="flex flex-col gap-3">
            {ASSETS.map((a) => {
              const v = s.assets.find((x) => x.id === a.id)!;
              return (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{a.ticker}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" disabled={!owner} onClick={() => call("Pausing", d.compliance, complianceAbi, "setAssetPause", [a.id, !(v.paused && !v.frozen)])}>
                      {v.paused && !v.frozen ? "Resume" : "Pause"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={!owner} onClick={() => call("Freezing", d.compliance, complianceAbi, "setCorporateActionFreeze", [a.id, !v.frozen])}>
                      {v.frozen ? "Unfreeze" : "Freeze for corporate action"}
                    </Button>
                  </div>
                </div>
              );
            })}
            <div className="mt-2 grid grid-cols-[1fr_80px_80px_auto] items-end gap-2 border-t border-line pt-4">
              <Field label="Apply split or bonus">
                <select value={ca.asset} onChange={(e) => setCa({ ...ca, asset: e.target.value })}>
                  {ASSETS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.ticker}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="New">
                <input value={ca.num} onChange={(e) => setCa({ ...ca, num: e.target.value.replace(/\D/g, "") })} />
              </Field>
              <Field label="Old">
                <input value={ca.den} onChange={(e) => setCa({ ...ca, den: e.target.value.replace(/\D/g, "") })} />
              </Field>
              <Button disabled={!owner} onClick={() => call("Applying", d.assets, assetFactoryAbi, "applyCorporateAction", [Number(ca.asset), BigInt(ca.num), BigInt(ca.den)])}>
                Apply
              </Button>
            </div>
            <p className="text-[12.5px] text-muted">A 1:1 bonus is 2 new for 1 old: each token then stands for two shares. The asset must be frozen first.</p>
            <div className="mt-2 flex items-end gap-2 border-t border-line pt-4">
              <Field label="Block an address" className="flex-1">
                <input value={deny} onChange={(e) => setDeny(e.target.value.trim())} placeholder="0x…" />
              </Field>
              <Button variant="ghost" disabled={!owner || !/^0x[0-9a-fA-F]{40}$/.test(deny)} onClick={() => call("Blocking", d.compliance, complianceAbi, "setDenied", [deny, true])}>
                Block
              </Button>
              <Button variant="ghost" disabled={!owner || !/^0x[0-9a-fA-F]{40}$/.test(deny)} onClick={() => call("Unblocking", d.compliance, complianceAbi, "setDenied", [deny, false])}>
                Unblock
              </Button>
            </div>
          </div>
        </Panel>

        <Panel title="Upkeep" description="Permissionless actions the keeper runs automatically; anyone can trigger them.">
          <div className="flex flex-col gap-3">
            {s.assets.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2">
                <span className="text-[13.5px]">
                  {a.ticker} batch: {a.batch ? `${units(a.batch.units)} waiting for session ${a.batch.session}` : "empty"}
                </span>
                <Button size="sm" variant="ghost" disabled={!a.batch} onClick={() => call("Processing batch", d.redemption, redemptionEngineAbi, "processBatch", [a.id, []])}>
                  Process
                </Button>
              </div>
            ))}
            {s.brokers
              .filter((b) => b.status === 3 || b.status === 4)
              .map((b) => (
                <div key={b.address} className="flex items-center justify-between gap-2">
                  <span className="text-[13.5px]">Move {b.name}&apos;s pledges to the front of the queue</span>
                  <Button size="sm" variant="ghost" onClick={() => call("Requeueing", d.levelBook, levelBookAbi, "requeueBroker", [b.address, 50n])}>
                    Requeue
                  </Button>
                </div>
              ))}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13.5px]">Refresh every pledge&apos;s queue level</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => call("Syncing", d.levelBook, levelBookAbi, "syncMany", [s.pledges.filter((p) => p.status === 2).map((p) => BigInt(p.id))])}
              >
                Sync
              </Button>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Panel title="Parameters" flush>
          <table>
            <tbody>
              {Object.entries(s.params).map(([k, v]) => (
                <tr key={k}>
                  <td className="num text-[12.5px]">{k}</td>
                  <td className="r num">{fmtParam(k, v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-end gap-2 border-t border-line px-5 py-4">
            <Field label="Parameter" className="flex-1">
              <select value={param.key} onChange={(e) => setParam({ ...param, key: e.target.value })}>
                {Object.keys(s.params).map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </Field>
            <Field label="Raw value" className="w-36">
              <input value={param.value} onChange={(e) => setParam({ ...param, value: e.target.value.replace(/\D/g, "") })} />
            </Field>
            <Button disabled={!owner || !param.value} onClick={() => call("Updating", d.params, paramsAbi, "set", [paramKey(param.key), BigInt(param.value)])}>
              Set
            </Button>
          </div>
        </Panel>
        <Panel title="Contracts" flush>
          <table>
            <tbody>
              {(["directory", "sessionClock", "priceOracle", "roles", "assets", "bondVault", "brokers", "levelBook", "pledges", "redemption", "exchange", "compliance", "params", "usdc"] as const).map((k) => (
                <tr key={k}>
                  <td className="text-[13px]">{k}</td>
                  <td className="r">
                    <Addr a={d[k] as string} label={`${(d[k] as string).slice(0, 10)}…`} />
                  </td>
                </tr>
              ))}
              {d.tokens.map((t, i) => (
                <tr key={t}>
                  <td className="text-[13px]">{ASSETS[i].symbol}</td>
                  <td className="r">
                    <Addr a={t} label={`${t.slice(0, 10)}…`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
