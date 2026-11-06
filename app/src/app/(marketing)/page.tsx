"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Wordmark } from "@/components/Brand";
import { AssetName, BackingMeter, Skeleton, ticker, usd } from "@/components/ui";
import { chain } from "@/lib/config";
import { until, useNow, useSnapshot } from "@/lib/hooks";
import { marketPrice, pledgedUnits, premiumPct, sumBig } from "@/lib/market";
import type { Session } from "@/lib/types";

/* ------------------------------------------------------------------ hero: sessions and the live board */

function SessionStrip() {
  const { data: s } = useSnapshot();
  const now = useNow();
  if (!s) return <Skeleton dark className="h-[132px] w-full rounded-2xl" />;
  const sessions: Session[] = s.calendar.sessions;
  if (!sessions.length) return null;
  const start = Math.min(sessions[0].open, now);
  const end = sessions[sessions.length - 1].close;
  const span = Math.max(end - start, 1);
  const pos = (t: number) => Math.min(100, Math.max(0, ((t - start) / span) * 100));
  const openTime = sessions.reduce((a, x) => a + (x.close - x.open), 0);
  const { current, next } = s.calendar;
  return (
    <figure className="rounded-2xl border border-dark-line bg-dark-2 p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <figcaption className="text-[13px] text-on-dark-soft">Upcoming trading sessions</figcaption>
        <span className="num text-[13px] text-on-dark-soft">
          {current ? `NSE closes in ${until(current.close, now)}` : next ? `NSE opens in ${until(next.open, now)}` : ""}
        </span>
      </div>
      <div className="relative mt-5">
        <div className="grid grid-cols-[88px_1fr] items-center gap-x-4 gap-y-3">
          <span className="text-[13px] font-medium text-on-dark">NSE</span>
          <div className="relative h-3 rounded-full bg-dark-line">
            {sessions.map((x) => (
              <span
                key={x.index}
                className="absolute inset-y-0 rounded-[3px] bg-on-dark-soft"
                style={{ left: `${pos(x.open)}%`, width: `${Math.max(pos(x.close) - pos(x.open), 0.6)}%` }}
                title={`Session ${x.index}`}
              />
            ))}
          </div>
          <span className="text-[13px] font-medium text-on-dark">Bull Street</span>
          <div className="h-3 rounded-full bg-accent-dark" />
        </div>
        <div className="pointer-events-none absolute inset-y-[-6px] left-[104px] right-0">
          <span className="absolute inset-y-0 w-px bg-white" style={{ left: `${pos(now)}%` }}>
            <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-white" />
          </span>
        </div>
      </div>
      <p className="mt-4 text-[13px] text-on-dark-soft">
        NSE trades <span className="num text-on-dark">{((openTime / span) * 100).toFixed(0)}%</span> of this window. Bull Street&apos;s order
        book stays open the rest of the time.
      </p>
    </figure>
  );
}

function PremiumDark({ pct }: { pct?: number }) {
  if (pct === undefined) return <span>–</span>;
  return (
    <span className={`num ${pct > 0 ? "text-up-dark" : pct < 0 ? "text-down-dark" : ""}`}>
      {pct > 0 ? "+" : ""}
      {pct.toFixed(2)}%
    </span>
  );
}

function LiveBoard() {
  const { data: s } = useSnapshot();
  return (
    <div className="overflow-hidden rounded-2xl border border-dark-line bg-dark-2">
      <div className="flex items-center justify-between border-b border-dark-line px-5 py-3.5">
        <span className="text-[13px] font-medium text-on-dark">Markets</span>
        <span className="flex items-center gap-2 text-[12.5px] text-on-dark-soft">
          <span className="size-1.5 rounded-full bg-up-dark" /> Live on {chain.name}
        </span>
      </div>
      {!s ? (
        <div className="flex flex-col gap-3 p-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} dark className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <ul>
          {s.assets.map((a) => {
            const price = marketPrice(a);
            return (
              <li
                key={a.id}
                className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-3 border-b border-dark-line px-5 py-4 last:border-0 md:grid-cols-[1.4fr_0.9fr_0.9fr_1.4fr_auto]"
              >
                <AssetName assetId={a.id} dark />
                <div className="hidden text-right md:block">
                  <div className="num text-[15px] text-on-dark">{price ? usd(price) : "–"}</div>
                  <div className="text-[12px] text-on-dark-soft">{price ? "order book" : "no orders"}</div>
                </div>
                <div className="hidden text-right md:block">
                  <div className="num text-[14px] text-on-dark-soft">{BigInt(a.close) > 0n ? usd(a.close) : "–"}</div>
                  <div className="text-[12px] text-on-dark-soft">
                    NSE close{price ? <> · <PremiumDark pct={premiumPct(price, a.close)} /></> : null}
                  </div>
                </div>
                <BackingMeter
                  dark
                  tokens={BigInt(a.supply)}
                  pledged={pledgedUnits(a.id, s.pledges)}
                  reserve={BigInt(a.reserve.units)}
                  className="col-span-2 md:col-span-1"
                />
                <Link
                  href={`/trade?asset=${a.id}`}
                  className="col-start-2 row-start-1 inline-flex h-9 items-center gap-1.5 justify-self-end rounded-full bg-on-dark px-4 text-[13.5px] font-semibold text-ink transition-colors hover:bg-accent-dark md:col-start-auto md:row-start-auto"
                >
                  Trade {ticker(a.id)}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ sections */

const STEPS = [
  {
    title: "Pledge from your demat",
    body: "Pledge shares to a bonded broker at CDSL, from a connected account or yourself in CDSL Easiest. The shares stay in your account; the pledge locks them.",
    detail: "100 RELIANCE pledged",
  },
  {
    title: "Mint and list, any hour",
    body: "Once the broker confirms the pledge, mint one token per share and post your own price on the order book, including at weekends.",
    detail: "100 bRELIANCE minted",
  },
  {
    title: "Redeem for USDC",
    body: "Any holder can redeem. The payout is priced at the next session's NSE close: the owner can pay it, the broker sells the shares, or the bond pays 105%.",
    detail: "priced at the next close",
  },
];

const ROLES = [
  {
    who: "Shareholders",
    what: "Earn from shares you keep. Mint against a pledge and sell at your own price, including into weekend demand when buyers pay above NSE.",
    href: "/mint",
    cta: "Start minting",
  },
  {
    who: "Traders",
    what: "Buy and sell Indian large caps peer to peer at 2 a.m. on a Sunday. Post a limit order or take one. Every token is redeemable for USDC.",
    href: "/trade",
    cta: "Open the order book",
  },
  {
    who: "Pledge brokers",
    what: "Hold pledges in your CDSL account, post a USDC bond, and earn half of every mint and redemption fee on your pledges. Settlement runs through your NSE access.",
    href: "/broker",
    cta: "Become a broker",
  },
];

const GUARANTEES = [
  [
    "Backing, enforced",
    "For every stock, tokens in existence equal pledged shares plus the bond-funded reserve. The contracts track it on every mint, burn and redemption, and any shortfall is shown, never hidden.",
  ],
  [
    "Bonded brokers",
    "Brokers keep USDC worth 110% of what is pledged to them, 125% over long closures. A broker below the line has a day to top up before it starts draining.",
  ],
  [
    "Fair redemption prices",
    "Redemptions are priced at the close of the first session after you ask, so nobody can redeem at a stale price after news breaks. A broker that misses the deadline pays 105% from its bond.",
  ],
  [
    "One person, one role",
    "World ID confirms every minter and broker is a unique person, so no one can be both sides of a pledge. Transfers to blocked accounts are refused by the token itself.",
  ],
] as const;

function BackingSection() {
  const { data: s } = useSnapshot();
  const bonds = sumBig(s?.brokers.map((b) => b.bond) ?? []);
  return (
    <section className="bg-soft">
      <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_1.2fr] lg:gap-20">
        <div>
          <h2 className="display text-[40px] text-ink sm:text-[44px]">Backing you can check, not just trust.</h2>
          <p className="mt-5 max-w-[46ch] text-[16px] leading-relaxed text-body">
            Every market shows its tokens against the shares pledged behind them, read straight from the contracts. No custodian report,
            no monthly attestation.
          </p>
          <Link href="/markets" className="mt-8 inline-flex items-center gap-1.5 text-[15px] font-semibold text-accent hover:underline">
            See all markets <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
        <div className="rounded-3xl border border-line bg-canvas p-6 sm:p-8">
          {!s ? (
            <div className="flex flex-col gap-6">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            <>
              <ul className="flex flex-col gap-7">
                {s.assets.map((a) => (
                  <li key={a.id} className="grid grid-cols-[1fr_1.2fr] items-center gap-6">
                    <AssetName assetId={a.id} />
                    <BackingMeter tokens={BigInt(a.supply)} pledged={pledgedUnits(a.id, s.pledges)} reserve={BigInt(a.reserve.units)} />
                  </li>
                ))}
              </ul>
              <dl className="mt-8 grid grid-cols-2 gap-6 border-t border-line pt-6">
                <div>
                  <dt className="text-[13px] text-muted">Broker bonds posted</dt>
                  <dd className="num mt-1 text-[22px]">{usd(bonds, 0)}</dd>
                </div>
                <div>
                  <dt className="text-[13px] text-muted">Bond requirement now</dt>
                  <dd className="num mt-1 text-[22px]">{s.calendar.extendedClosure ? "125%" : "110%"}</dd>
                </div>
              </dl>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <div className="bg-canvas">
      <section className="bg-dark text-on-dark">
        <header className="mx-auto flex h-16 max-w-[1200px] items-center gap-8 px-4 sm:px-6">
          <Wordmark dark />
          <nav className="hidden items-center gap-6 text-[14px] text-on-dark-soft md:flex" aria-label="Sections">
            <a href="#how" className="hover:text-on-dark">How it works</a>
            <a href="#roles" className="hover:text-on-dark">Who it&apos;s for</a>
            <a href="#guarantees" className="hover:text-on-dark">Guarantees</a>
          </nav>
          <Link
            href="/markets"
            className="ml-auto inline-flex h-9 items-center rounded-full bg-on-dark px-4 text-[13.5px] font-semibold text-ink transition-colors hover:bg-accent-dark"
          >
            Launch app
          </Link>
        </header>

        <div className="mx-auto max-w-[1200px] px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
          <div className="grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:items-end">
            <div>
              <h1 className="display text-[44px] sm:text-[64px] lg:text-[72px]">Indian stocks, open when NSE isn&apos;t.</h1>
              <p className="mt-6 max-w-[52ch] text-[17px] leading-relaxed text-on-dark-soft">
                Shareholders mint a token for every share they pledge from their own demat account and sell it at their own price.
                Anyone can trade peer to peer around the clock and redeem for USDC through bonded brokers.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link
                  href="/trade"
                  className="inline-flex h-12 items-center gap-2 rounded-full bg-accent-dark px-6 text-[15px] font-semibold text-ink transition-colors hover:bg-white"
                >
                  Start trading <ArrowRight className="size-4" aria-hidden />
                </Link>
                <Link
                  href="/mint"
                  className="inline-flex h-12 items-center rounded-full border border-on-dark/30 px-6 text-[15px] font-semibold text-on-dark transition-colors hover:border-on-dark"
                >
                  Mint against your shares
                </Link>
              </div>
            </div>
            <SessionStrip />
          </div>
          <div className="mt-14">
            <LiveBoard />
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-[1200px] scroll-mt-8 px-4 py-24 sm:px-6">
        <h2 className="display max-w-[18ch] text-[40px] sm:text-[44px]">From your demat account to a 24/7 market, in three steps.</h2>
        <ol className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative border-t border-ink pt-6">
              <span className="num text-[13px] text-muted">Step {i + 1}</span>
              <h3 className="mt-3 text-[20px] font-semibold tracking-[-0.01em]">{s.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-body">{s.body}</p>
              <p className="num mt-5 inline-flex rounded-full bg-strong px-3 py-1 text-[12.5px] text-ink">{s.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <BackingSection />

      <section id="roles" className="mx-auto max-w-[1200px] scroll-mt-8 px-4 py-24 sm:px-6">
        <h2 className="display max-w-[20ch] text-[40px] sm:text-[44px]">One market, three ways in.</h2>
        <div className="mt-12 border-t border-line">
          {ROLES.map((r) => (
            <Link
              key={r.who}
              href={r.href}
              className="group grid gap-3 border-b border-line py-8 transition-colors hover:bg-soft sm:grid-cols-[220px_1fr_auto] sm:items-center sm:gap-10 sm:px-4"
            >
              <span className="text-[22px] font-semibold tracking-[-0.01em]">{r.who}</span>
              <span className="max-w-[60ch] text-[15px] leading-relaxed text-body">{r.what}</span>
              <span className="inline-flex items-center gap-1.5 text-[14.5px] font-semibold text-accent">
                {r.cta}{" "}
                <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section id="guarantees" className="scroll-mt-8 bg-dark text-on-dark">
        <div className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6">
          <h2 className="display max-w-[20ch] text-[40px] sm:text-[44px]">Guarantees written into the contracts.</h2>
          <dl className="mt-14 grid gap-px overflow-hidden rounded-3xl bg-dark-line md:grid-cols-2">
            {GUARANTEES.map(([t, b]) => (
              <div key={t} className="bg-dark p-8">
                <dt className="text-[18px] font-semibold">{t}</dt>
                <dd className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-on-dark-soft">{b}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
          <h2 className="display max-w-[16ch] text-[40px] sm:text-[52px]">Your shares, working around the clock.</h2>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/markets"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-accent px-6 text-[15px] font-semibold text-white transition-colors hover:bg-accent-hover"
            >
              Launch app <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href="/broker"
              className="inline-flex h-12 items-center rounded-full bg-strong px-6 text-[15px] font-semibold text-ink transition-colors hover:bg-[#e2e5e9]"
            >
              Become a broker
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-[44ch]">
            <Wordmark />
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Pledge-backed tokens for Indian equities, traded peer to peer. Shares stay in their owners&apos; demat accounts; backing is
              enforced on-chain.
            </p>
          </div>
          <nav className="grid grid-cols-2 gap-x-12 gap-y-2 text-[13.5px] text-body sm:grid-cols-3" aria-label="Footer">
            <Link href="/markets" className="hover:text-ink">Markets</Link>
            <Link href="/trade" className="hover:text-ink">Trade</Link>
            <Link href="/mint" className="hover:text-ink">Mint</Link>
            <Link href="/broker" className="hover:text-ink">Broker</Link>
            <Link href="/redeem" className="hover:text-ink">Redeem</Link>
          </nav>
        </div>
        <div className="border-t border-line">
          <p className="mx-auto max-w-[1200px] px-4 py-5 text-[12.5px] text-muted sm:px-6">
            © {new Date().getFullYear()} Bull Street. Testnet. Not an offer of securities. Token prices are set by traders and can differ
            from NSE prices.
          </p>
        </div>
      </footer>
    </div>
  );
}
