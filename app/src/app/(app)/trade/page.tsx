"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { maxUint256, parseUnits, type Address } from "viem";
import { ORDER_STATUS_LABEL, OrderStatus, Side, exchangeAbi, mockUsdcAbi, stockTokenAbi } from "@bullstreet/shared";
import { AssetTabs } from "@/components/AssetSelect";
import {
  AmountInput,
  AssetName,
  BackingMeter,
  Button,
  Change,
  Empty,
  Field,
  Note,
  Panel,
  Segmented,
  Skeleton,
  Stat,
  StatusPill,
  TxStatus,
  units,
  usd,
} from "@/components/ui";
import { api } from "@/lib/api";
import { ago, until, useAllowanceCheck, useDeployment, useNow, useSnapshot, useTx } from "@/lib/hooks";
import { marketPrice, pledgedUnits, premiumPct } from "@/lib/market";
import type { AssetView, BookOrder, Snapshot } from "@/lib/types";
import { useActiveAccount } from "@/lib/wallet";

const ONE = 10n ** 18n;
const valueOf = (amount: bigint, price: bigint, up = false) => (up ? (amount * price + ONE - 1n) / ONE : (amount * price) / ONE);

function levels(orders: BookOrder[]) {
  const m = new Map<string, bigint>();
  for (const o of orders) m.set(o.price, (m.get(o.price) ?? 0n) + BigInt(o.remaining));
  return [...m.entries()].map(([price, amount]) => ({ price: BigInt(price), amount }));
}

function OrderBook({ a, onPick }: { a: AssetView; onPick: (price: bigint) => void }) {
  const asks = levels(a.asks).slice(0, 8).reverse();
  const bids = levels(a.bids).slice(0, 8);
  const max = [...asks, ...bids].reduce((m, l) => (l.amount > m ? l.amount : m), 1n);
  const bestBid = bids[0]?.price;
  const bestAsk = asks[asks.length - 1]?.price;
  const Row = ({ l, side }: { l: { price: bigint; amount: bigint }; side: "bid" | "ask" }) => (
    <button
      onClick={() => onPick(l.price)}
      className="relative grid w-full grid-cols-3 px-5 py-1.5 text-left text-[13px] transition-colors hover:bg-soft"
      title="Use this price"
    >
      <span
        className={`absolute inset-y-0.5 right-0 ${side === "bid" ? "bg-up-soft" : "bg-down-soft"}`}
        style={{ width: `${Number((l.amount * 100n) / max)}%` }}
        aria-hidden
      />
      <span className={`num relative ${side === "bid" ? "text-up" : "text-down"}`}>{usd(l.price)}</span>
      <span className="num relative text-right text-ink">{units(l.amount)}</span>
      <span className="num relative text-right text-muted">{usd(valueOf(l.amount, l.price))}</span>
    </button>
  );
  return (
    <Panel title="Order book" description="Click a price to use it in your order." flush>
      <div className="grid grid-cols-3 border-b border-line bg-soft px-5 py-2 text-[12px] font-medium text-muted">
        <span>Price</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Total</span>
      </div>
      {!asks.length && !bids.length ? (
        <Empty title="No orders yet">Post the first order at your price. Sellers are usually minters listing tokens they just minted.</Empty>
      ) : (
        <div className="py-1.5">
          {asks.map((l) => (
            <Row key={`a${l.price}`} l={l} side="ask" />
          ))}
          <div className="my-1 flex items-center justify-between border-y border-line bg-soft px-5 py-2 text-[12.5px]">
            <span className="text-muted">Spread</span>
            <span className="num text-ink">{bestBid && bestAsk ? usd(bestAsk - bestBid) : "–"}</span>
            <span className="text-muted">
              vs NSE <Change pct={premiumPct(marketPrice(a), a.close)} />
            </span>
          </div>
          {bids.map((l) => (
            <Row key={`b${l.price}`} l={l} side="bid" />
          ))}
        </div>
      )}
    </Panel>
  );
}

interface TradeEv {
  tx: string;
  ts: number;
  args: { amount: string; usdc: string; side: string; id: string };
}

function RecentTrades({ assetId }: { assetId: number }) {
  const now = useNow();
  const { data } = useQuery({ queryKey: ["trades", assetId], queryFn: () => api<TradeEv[]>(`/activity/trades/${assetId}`), refetchInterval: 5000 });
  return (
    <Panel title="Recent trades" flush>
      {!data?.length ? (
        <Empty title="No trades yet">Fills on the order book appear here.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Price</th>
              <th className="r">Amount</th>
              <th className="r">When</th>
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 12).map((t) => {
              const amount = BigInt(t.args.amount);
              const price = amount > 0n ? (BigInt(t.args.usdc) * ONE) / amount : 0n;
              // the maker's side: a filled sell order means the taker bought
              const takerBought = Number(t.args.side) === Side.Sell;
              return (
                <tr key={`${t.tx}${t.args.id}`}>
                  <td className={`num ${takerBought ? "text-up" : "text-down"}`}>{usd(price)}</td>
                  <td className="r num">{units(amount)}</td>
                  <td className="r text-[12.5px] text-muted">{ago(t.ts, now)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

type Mode = "limit" | "instant";
type Expiry = "next" | "day" | "week";

function Ticket({ s, a, presetPrice, presetSide }: { s: Snapshot; a: AssetView; presetPrice?: bigint; presetSide?: "buy" | "sell" }) {
  const { data: d } = useDeployment();
  const { address } = useActiveAccount();
  const tx = useTx();
  const allowed = useAllowanceCheck();
  const now = useNow();
  const [side, setSide] = useState<"buy" | "sell">(presetSide ?? "buy");
  const [mode, setMode] = useState<Mode>("limit");
  const [priceIn, setPriceIn] = useState("");
  const [amountIn, setAmountIn] = useState("");
  const [expiry, setExpiry] = useState<Expiry>("next");
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (presetPrice) setPriceIn((Number(presetPrice) / 1e6).toFixed(2));
  }, [presetPrice]);
  useEffect(() => {
    if (presetSide) setSide(presetSide);
  }, [presetSide]);

  const amount = (() => {
    try {
      return amountIn ? parseUnits(amountIn, 18) : 0n;
    } catch {
      return 0n;
    }
  })();
  const limit = (() => {
    try {
      return priceIn ? parseUnits(priceIn, 6) : 0n;
    } catch {
      return 0n;
    }
  })();
  const feeBps = BigInt(s.params.TAKER_FEE_BPS ?? "10");
  const me = address?.toLowerCase();
  const book = side === "buy" ? a.asks : a.bids; // orders we would take
  const usable = book.filter((o) => o.maker.toLowerCase() !== me && o.expiry > now);

  const plan = useMemo(() => {
    let left = amount;
    const ids: bigint[] = [];
    let value = 0n;
    let worst = 0n;
    for (const o of usable) {
      if (left === 0n) break;
      const p = BigInt(o.price);
      if (mode === "limit" && limit > 0n && (side === "buy" ? p > limit : p < limit)) break;
      const x = BigInt(o.remaining) < left ? BigInt(o.remaining) : left;
      ids.push(BigInt(o.id));
      value += valueOf(x, p, side === "buy");
      worst = p;
      left -= x;
    }
    const filled = amount - left;
    return { ids, filled, rest: left, value, worst, fee: (value * feeBps) / 10_000n };
  }, [usable, amount, limit, mode, side, feeBps]);

  const balUsdc = BigInt(s.user?.usdc ?? 0);
  const balTok = BigInt(s.user?.balances[a.id] ?? 0);
  const restEscrow = mode === "limit" && plan.rest > 0n && limit > 0n ? valueOf(plan.rest, limit, true) : 0n;
  const needUsdc = side === "buy" ? plan.value + plan.fee + restEscrow : 0n;
  const short = side === "buy" ? needUsdc > balUsdc : amount > balTok;
  const instantShort = mode === "instant" && plan.filled < amount;

  const expiryTs = expiry === "next" ? 0n : BigInt(now + (expiry === "day" ? 86400 : 7 * 86400));

  const submit = async () => {
    if (!d || !address) return;
    setDone(null);
    const reqs = [];
    if (side === "buy" && !(await allowed(d.usdc, address as Address, d.exchange, needUsdc))) {
      reqs.push({ address: d.usdc, abi: mockUsdcAbi, functionName: "approve", args: [d.exchange, maxUint256] });
    }
    if (side === "sell" && !(await allowed(a.token, address as Address, d.exchange, amount))) {
      reqs.push({ address: a.token, abi: stockTokenAbi, functionName: "approve", args: [d.exchange, maxUint256] });
    }
    const params = {
      assetId: a.id,
      side: side === "buy" ? Side.Buy : Side.Sell,
      limitPrice: mode === "instant" ? plan.worst || 1n : limit,
      amount,
      fillIds: plan.ids,
      rest: mode === "limit",
      expiry: expiryTs,
      minFilled: mode === "instant" ? amount : 0n,
    };
    reqs.push({ address: d.exchange, abi: exchangeAbi, functionName: "trade", args: [params] });
    const ok = await tx.send(side === "buy" ? "Buying" : "Selling", ...reqs);
    if (ok) {
      setDone(
        plan.filled > 0n
          ? `Filled ${units(plan.filled)} ${a.symbol}${mode === "limit" && plan.rest > 0n ? `; ${units(plan.rest)} rests on the book` : ""}.`
          : `Order posted at ${usd(limit)}.`,
      );
      setAmountIn("");
    }
  };

  const disabled =
    !address || amount === 0n || short || (mode === "limit" && limit === 0n) || (mode === "instant" && (instantShort || plan.filled === 0n));

  return (
    <Panel title="Place an order">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            value={side}
            onChange={setSide}
            options={[
              ["buy", "Buy"],
              ["sell", "Sell"],
            ]}
          />
          <Segmented
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              ["limit", "Limit"],
              ["instant", "Instant"],
            ]}
          />
        </div>
        {mode === "limit" && (
          <Field label="Price per token">
            <AmountInput value={priceIn} onChange={setPriceIn} unit="USDC" placeholder={BigInt(a.close) > 0n ? (Number(a.close) / 1e6).toFixed(2) : "0.00"} />
          </Field>
        )}
        <Field
          label="Amount"
          hint={
            side === "sell"
              ? `You hold ${units(balTok)} ${a.symbol}`
              : `You have ${usd(balUsdc)} USDC`
          }
        >
          <AmountInput value={amountIn} onChange={setAmountIn} unit={a.symbol} />
        </Field>
        {mode === "limit" && (
          <Field label="Order expires" hint="Default: before the next NSE open, so your price cannot be picked off after news breaks.">
            <select value={expiry} onChange={(e) => setExpiry(e.target.value as Expiry)}>
              <option value="next">At the next NSE open</option>
              <option value="day">In 24 hours</option>
              <option value="week">In 7 days</option>
            </select>
          </Field>
        )}

        <dl className="grid grid-cols-2 gap-y-2 rounded-xl bg-soft px-4 py-3 text-[13px]">
          <dt className="text-muted">Fills now</dt>
          <dd className="num text-right">
            {units(plan.filled)} {a.symbol}
            {plan.filled > 0n && <span className="text-muted"> · avg {usd(plan.filled > 0n ? (plan.value * ONE) / plan.filled : 0n)}</span>}
          </dd>
          {mode === "limit" && (
            <>
              <dt className="text-muted">Rests on the book</dt>
              <dd className="num text-right">
                {units(plan.rest)} {a.symbol}
              </dd>
            </>
          )}
          <dt className="text-muted">Taker fee ({(Number(feeBps) / 100).toFixed(2)}%)</dt>
          <dd className="num text-right">{usd(plan.fee, 4)}</dd>
          <dt className="font-medium text-ink">{side === "buy" ? "You pay" : "You receive"}</dt>
          <dd className="num text-right font-medium text-ink">
            {side === "buy" ? usd(needUsdc) : usd(plan.value - plan.fee)}
            {side === "sell" && mode === "limit" && plan.rest > 0n && limit > 0n && (
              <span className="text-muted"> + {usd(valueOf(plan.rest, limit))} if filled</span>
            )}
          </dd>
        </dl>

        {mode === "instant" && amount > 0n && instantShort && (
          <Note tone="warn">Only {units(plan.filled)} is available right now. Use a limit order to post the rest at your price.</Note>
        )}
        {short && amount > 0n && <Note tone="warn">{side === "buy" ? "Not enough USDC for this order." : `Not enough ${a.symbol}.`}</Note>}
        <Button size="lg" onClick={submit} disabled={disabled} loading={!!tx.pending}>
          {!address ? "Connect a wallet" : side === "buy" ? (mode === "instant" ? "Buy now" : "Place buy order") : mode === "instant" ? "Sell now" : "Place sell order"}
        </Button>
        <TxStatus pending={tx.pending} error={tx.error} success={done} />
        {a.paused && <Note tone="warn">Trading in {a.symbol} is paused{a.frozen ? " for a corporate action" : ""}.</Note>}
      </div>
    </Panel>
  );
}

function MyOrders({ s, a }: { s: Snapshot; a: AssetView }) {
  const { data: d } = useDeployment();
  const tx = useTx();
  const now = useNow();
  const orders = (s.user?.orders ?? []).filter((o) => o.assetId === a.id);
  if (!s.user) return null;
  return (
    <Panel title="Your orders" flush>
      {!orders.length ? (
        <Empty title="No orders">Orders you post on {a.symbol} appear here until they fill, expire or you cancel them.</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Side</th>
              <th className="r">Price</th>
              <th className="r">Filled</th>
              <th>Status</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const open = o.status === OrderStatus.Open;
              const expired = open && o.expiry <= now;
              return (
                <tr key={o.id}>
                  <td className={o.side === Side.Buy ? "text-up" : "text-down"}>{o.side === Side.Buy ? "Buy" : "Sell"}</td>
                  <td className="r num">{usd(o.price)}</td>
                  <td className="r num">
                    {units(BigInt(o.amount) - BigInt(o.remaining))} / {units(o.amount)}
                  </td>
                  <td>
                    <StatusPill tone={open && !expired ? "accent" : o.status === OrderStatus.Filled ? "up" : "neutral"}>
                      {expired ? "Expired" : ORDER_STATUS_LABEL[o.status]}
                    </StatusPill>
                  </td>
                  <td className="text-[13px] text-muted">{open ? (expired ? "–" : `in ${until(o.expiry, now)}`) : "–"}</td>
                  <td className="r">
                    {open && d && (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={tx.pending === `order ${o.id}`}
                        onClick={() =>
                          tx.send(`order ${o.id}`, {
                            address: d.exchange,
                            abi: exchangeAbi,
                            functionName: expired ? "reclaim" : "cancel",
                            args: [BigInt(o.id)],
                          })
                        }
                      >
                        {expired ? "Reclaim" : "Cancel"}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {tx.error && <p className="px-5 pb-4 text-[13px] text-down">{tx.error}</p>}
    </Panel>
  );
}

function TradeInner() {
  const params = useSearchParams();
  const { data: s } = useSnapshot();
  const [assetId, setAssetId] = useState(Number(params.get("asset") ?? 1));
  const [picked, setPicked] = useState<bigint | undefined>(params.get("price") ? BigInt(params.get("price")!) : undefined);
  const presetSide = params.get("side") === "sell" ? "sell" : params.get("side") === "buy" ? "buy" : undefined;
  if (!s) return <Skeleton className="h-[600px] w-full rounded-2xl" />;
  const a = s.assets.find((x) => x.id === assetId) ?? s.assets[0];
  const price = marketPrice(a);
  return (
    <div className="flex flex-col gap-6">
      <AssetTabs value={a.id} onChange={setAssetId} />
      <section className="rounded-2xl border border-line bg-canvas p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <AssetName assetId={a.id} />
          <div className="grid flex-1 grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="Market price" value={price ? usd(price) : "–"} sub={price ? "order book midpoint" : "no orders yet"} />
            <Stat label="NSE close" value={BigInt(a.close) > 0n ? usd(a.close) : "–"} sub={`session ${a.closeSession}`} />
            <Stat label="vs NSE" value={<Change pct={premiumPct(price, a.close)} />} sub={s.calendar.open ? "NSE is open" : "NSE is closed"} />
            <Stat label="Tokens outstanding" value={units(a.supply, 0)} sub={`${units(a.reserve.units, 0)} on reserve`} />
          </div>
        </div>
        <BackingMeter className="mt-5" tokens={BigInt(a.supply)} pledged={pledgedUnits(a.id, s.pledges)} reserve={BigInt(a.reserve.units)} />
      </section>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-6">
          <OrderBook a={a} onPick={setPicked} />
          <MyOrders s={s} a={a} />
          <RecentTrades assetId={a.id} />
        </div>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Ticket s={s} a={a} presetPrice={picked} presetSide={presetSide} />
        </aside>
      </div>
    </div>
  );
}

export default function TradePage() {
  return (
    <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-2xl" />}>
      <TradeInner />
    </Suspense>
  );
}
