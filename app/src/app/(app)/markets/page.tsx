"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { BROKER_STATUS_LABEL, BrokerStatus, TIER_LABEL } from "@bullstreet/shared";
import {
  Addr,
  AssetName,
  BackingMeter,
  Change,
  Empty,
  LinkButton,
  PageHeader,
  Panel,
  RatioMeter,
  Segmented,
  Skeleton,
  StatusPill,
  assetOf,
  units,
  usd,
} from "@/components/ui";
import { api } from "@/lib/api";
import { ago, useNow, useSnapshot } from "@/lib/hooks";
import { marketPrice, pledgedUnits, premiumPct, sumBig } from "@/lib/market";
import type { Snapshot } from "@/lib/types";

function RuleBanner({ s }: { s: Snapshot }) {
  const unbacked = sumBig(s.assets.map((a) => a.unbacked));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-canvas px-5 py-4">
      <div className="flex items-center gap-3">
        <StatusPill tone={unbacked > 0n ? "down" : "up"}>{unbacked > 0n ? "Shortfall" : "Fully backed"}</StatusPill>
        <p className="text-[14px] text-body">
          {unbacked > 0n
            ? `${units(unbacked)} tokens lost their backing after a broker default and are shown as unbacked.`
            : `Every token across all ${s.assets.length} markets is backed by a pledged share or the bond-funded reserve.`}
        </p>
      </div>
      <span className="text-[12.5px] text-muted">Read from the contracts at block {s.block.toLocaleString("en-US")}</span>
    </div>
  );
}

function MarketsTable({ s }: { s: Snapshot }) {
  const now = useNow();
  return (
    <Panel title="Stocks" description="Prices come from people's orders; the NSE close is the reference." flush>
      <table>
        <thead>
          <tr>
            <th>Stock</th>
            <th className="r">Market</th>
            <th className="r">NSE close</th>
            <th className="r">vs NSE</th>
            <th className="r">Bid / Ask</th>
            <th>Backing</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {s.assets.map((a) => {
            const price = marketPrice(a);
            return (
              <tr key={a.id}>
                <td>
                  <AssetName assetId={a.id} />
                </td>
                <td className="r num">{price ? usd(price) : <span className="font-sans text-muted">No orders</span>}</td>
                <td className="r">
                  <div className="num">{BigInt(a.close) > 0n ? usd(a.close) : "–"}</div>
                  <div className="text-[12px] text-muted">{a.stale ? "awaiting today's close" : `posted ${ago(a.asOf, now)}`}</div>
                </td>
                <td className="r">
                  <Change pct={premiumPct(price, a.close)} />
                </td>
                <td className="r num text-[13px]">
                  <span className="text-up">{a.bids[0] ? usd(a.bids[0].price) : "–"}</span>
                  <span className="text-muted"> / </span>
                  <span className="text-down">{a.asks[0] ? usd(a.asks[0].price) : "–"}</span>
                </td>
                <td className="w-[220px]">
                  <BackingMeter tokens={BigInt(a.supply)} pledged={pledgedUnits(a.id, s.pledges)} reserve={BigInt(a.reserve.units)} />
                </td>
                <td className="r">
                  <LinkButton href={`/trade?asset=${a.id}`} variant="secondary" className="!h-8 !px-3.5 !text-[13px]">
                    Trade
                  </LinkButton>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

const statusTone = (s: number) =>
  s === BrokerStatus.Active ? "up" : s === BrokerStatus.Defaulted ? "down" : s === BrokerStatus.Draining || s === BrokerStatus.Pending ? "warn" : "neutral";

function BrokersTable({ s }: { s: Snapshot }) {
  if (!s.brokers.length) return null;
  return (
    <Panel title="Brokers" description="Each broker holds pledges in its CDSL account and posts a USDC bond that covers them." flush>
      <table>
        <thead>
          <tr>
            <th>Broker</th>
            <th>Tier</th>
            <th>Status</th>
            <th className="r">Bond</th>
            <th className="r">Pledged value</th>
            <th>Coverage</th>
            <th className="r">Capacity left</th>
          </tr>
        </thead>
        <tbody>
          {s.brokers.map((b) => {
            const health = b.health === null ? null : Number(b.health) / 100;
            const left = BigInt(b.capacity) - BigInt(b.exposure);
            return (
              <tr key={b.address}>
                <td>
                  <div className="font-medium text-ink">{b.name}</div>
                  <Addr a={b.address} label={undefined} />
                </td>
                <td>{TIER_LABEL[b.tier]}</td>
                <td>
                  <StatusPill tone={statusTone(b.status)}>{BROKER_STATUS_LABEL[b.status]}</StatusPill>
                </td>
                <td className="r num">{usd(b.bond, 0)}</td>
                <td className="r num">{usd(b.exposure, 0)}</td>
                <td className="w-[180px]">
                  {health === null ? (
                    <span className="text-[13px] text-muted">No pledges yet</span>
                  ) : (
                    <div>
                      <RatioMeter value={health} required={100} />
                      <div className="num mt-1.5 text-[11.5px] text-muted">{health.toFixed(0)}% of requirement</div>
                    </div>
                  )}
                </td>
                <td className="r num">{usd(left > 0n ? left : 0n, 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

function QueueLevels({ s }: { s: Snapshot }) {
  return (
    <Panel
      title="Redemption queue"
      description="Redemptions draw on backing level by level: reserve first, then draining brokers, volunteers, at-risk pledges, and the rest."
      flush
    >
      <table>
        <thead>
          <tr>
            <th>Stock</th>
            <th className="r">Reserve</th>
            <th className="r">Draining brokers</th>
            <th className="r">Volunteers</th>
            <th className="r">At risk</th>
            <th className="r">Normal</th>
            <th className="r">Waiting in batch</th>
          </tr>
        </thead>
        <tbody>
          {s.assets.map((a) => (
            <tr key={a.id}>
              <td className="font-medium">{a.symbol}</td>
              <td className="r num">{units(a.reserve.free)}</td>
              <td className="r num">{units(a.levels.drain)}</td>
              <td className="r num">{units(a.levels.volunteer)}</td>
              <td className="r num">{units(a.levels.atRisk)}</td>
              <td className="r num">{units(a.levels.normal)}</td>
              <td className="r num">{a.batch ? units(a.batch.units) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

interface Ev {
  name: string;
  tx: string;
  ts: number;
  args: Record<string, string>;
}

const describe = (e: Ev): string => {
  const a = e.args;
  const sym = assetOf(Number(a.assetId))?.symbol ?? "";
  switch (e.name) {
    case "PledgeOpened":
      return `Pledge #${a.pledgeId} opened: ${a.shares} shares`;
    case "PledgeAttested":
      return `Pledge #${a.pledgeId} confirmed by its broker`;
    case "Minted":
      return `${a.shares} tokens minted on pledge #${a.pledgeId}`;
    case "OrderFilled":
      return `${units(a.amount)} ${sym} traded for ${usd(a.usdc)}`;
    case "TicketCreated":
      return `Redemption #${a.ticketId}: ${units(a.units)} ${sym}`;
    case "Settled":
      return `Allocation #${a.allocId} settled by the broker (${usd(a.toHolder)})`;
    case "Cured":
      return `Allocation #${a.allocId} paid by the minter (${usd(a.toHolder)})`;
    case "DefaultClaimed":
      return `Allocation #${a.allocId} paid from the bond (${usd(a.paid)})`;
    case "ReservePaid":
      return `Allocation #${a.allocId} paid from the reserve`;
    case "StaleSlashed":
      return `Pledge #${a.pledgeId} moved to the reserve`;
    case "BrokerStatusChanged":
      return `A broker is now ${BROKER_STATUS_LABEL[Number(a.to)].toLowerCase()}`;
    default:
      return e.name;
  }
};

function Activity() {
  const now = useNow();
  const [tab, setTab] = useState<"all" | "trades" | "redemptions">("all");
  const names =
    tab === "trades" ? "OrderFilled" : tab === "redemptions" ? "TicketCreated,Settled,Cured,DefaultClaimed,ReservePaid" : undefined;
  const { data, isLoading } = useQuery({
    queryKey: ["activity", tab],
    queryFn: () => api<Ev[]>(`/activity?limit=25${names ? `&names=${names}` : ""}`),
    refetchInterval: 6000,
  });
  return (
    <Panel
      title="Activity"
      actions={
        <Segmented
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            ["all", "All"],
            ["trades", "Trades"],
            ["redemptions", "Redemptions"],
          ]}
        />
      }
      flush
    >
      {isLoading ? (
        <div className="p-5">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !data?.length ? (
        <Empty title="Nothing yet">Pledges, mints, trades and redemptions appear here as they happen.</Empty>
      ) : (
        <ul>
          {data.map((e) => (
            <li key={`${e.tx}-${e.name}-${JSON.stringify(e.args).length}`} className="flex items-center justify-between gap-4 border-b border-line px-5 py-3 last:border-0">
              <span className="text-[13.5px] text-ink">{describe(e)}</span>
              <span className="num shrink-0 text-[12px] text-muted">{ago(e.ts, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function MarketsPage() {
  const { data: s } = useSnapshot();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Markets"
        description="Pledge-backed tokens for NSE stocks, traded peer to peer. Each token is matched by a share pledged at CDSL or by reserve cash."
        actions={<Link href="/trade" className="text-[14px] font-semibold text-accent hover:underline">Open the order book</Link>}
      />
      {!s ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : (
        <>
          <RuleBanner s={s} />
          <MarketsTable s={s} />
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <BrokersTable s={s} />
            <Activity />
          </div>
          <QueueLevels s={s} />
        </>
      )}
    </div>
  );
}
