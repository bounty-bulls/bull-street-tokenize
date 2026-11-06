"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnect } from "wagmi";
import { Bell, Check, ChevronDown, Copy, ExternalLink, Fingerprint, LogOut, Wallet } from "lucide-react";
import { ROLE_LABEL } from "@bullstreet/shared";
import { EXPLORER, IS_LOCAL, PASSKEY_ENABLED, chain } from "@/lib/config";
import { api } from "@/lib/api";
import { short, until, useNow, useSnapshot } from "@/lib/hooks";
import { useActiveAccount, useDisconnectAll, usePasskey, usePersonas } from "@/lib/wallet";
import { Wordmark } from "./Brand";
import { StatusPill, usd } from "./ui";

const NAV = [
  ["/markets", "Markets"],
  ["/trade", "Trade"],
  ["/mint", "Mint"],
  ["/broker", "Broker"],
  ["/redeem", "Redeem"],
] as const;

export function MarketStatus() {
  const { data: s } = useSnapshot();
  const now = useNow();
  if (!s) return <StatusPill>NSE</StatusPill>;
  const { current, next, extendedClosure } = s.calendar;
  if (current) {
    return (
      <StatusPill tone="up" title="Trading session in progress">
        NSE open · closes in {until(current.close, now)}
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="warn" title={extendedClosure ? "Long closure: brokers post a 125% bond" : "Between sessions"}>
      NSE closed{next ? ` · opens in ${until(next.open, now)}` : ""}
    </StatusPill>
  );
}

function useClickAway(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, close]);
  return ref;
}

interface Notice {
  id: number;
  ts: number;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: number;
}

function Notices() {
  const { address } = useActiveAccount();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, () => setOpen(false));
  const { data } = useQuery({
    queryKey: ["notices", address],
    enabled: !!address,
    queryFn: () => api<{ unread: number; items: Notice[] }>(`/notices/${address}`),
    refetchInterval: 8000,
  });
  if (!address) return null;
  const toggle = async () => {
    setOpen((o) => !o);
    if (!open && data?.unread) {
      await api(`/notices/${address}/read`, { method: "POST", body: {} }).catch(() => {});
      void qc.invalidateQueries({ queryKey: ["notices"] });
    }
  };
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ""}`}
        className="relative inline-flex size-9 items-center justify-center rounded-full border border-line bg-canvas text-body transition-colors hover:bg-soft"
      >
        <Bell className="size-4" aria-hidden />
        {!!data?.unread && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent" />}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-80 overflow-hidden rounded-2xl border border-line bg-canvas shadow-[var(--shadow-float)]">
          <div className="border-b border-line px-4 py-3 text-[13.5px] font-semibold">Notifications</div>
          <div className="max-h-96 overflow-y-auto">
            {!data?.items.length && <p className="px-4 py-6 text-center text-[13px] text-muted">Alerts about your pledges, redemptions and orders appear here.</p>}
            {data?.items.map((n) => (
              <Link
                key={n.id}
                href={n.link ?? "#"}
                onClick={() => setOpen(false)}
                className="block border-b border-line px-4 py-3 last:border-0 hover:bg-soft"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[13px] font-semibold text-ink">{n.title}</span>
                  <span className="num shrink-0 text-[11.5px] text-muted">
                    {new Date(n.ts * 1000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="mt-0.5 text-[12.5px] leading-snug text-body">{n.body}</p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left hover:bg-soft">
      {children}
    </button>
  );
}

function ConnectMenu({ onDone }: { onDone: () => void }) {
  const { connectors, connect } = useConnect();
  const personas = usePersonas();
  const pk = usePasskey();
  const [name, setName] = useState("");
  const injected = connectors.find((c) => c.type === "injected");
  const local = connectors.filter((c) => c.type === "mock");
  return (
    <div className="absolute right-0 top-11 z-30 w-72 overflow-hidden rounded-2xl border border-line bg-canvas p-1.5 text-[13.5px] shadow-[var(--shadow-float)]">
      <MenuItem
        onClick={() => {
          if (injected) connect({ connector: injected, chainId: chain.id });
          onDone();
        }}
      >
        <Wallet className="size-4 text-muted" /> Browser wallet
      </MenuItem>
      {PASSKEY_ENABLED && pk && (
        <div className="mt-1 border-t border-line px-2.5 pb-2 pt-2.5">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-body">
            <Fingerprint className="size-4 text-accent" /> Passkey wallet
          </div>
          <p className="mt-1 text-[12px] leading-snug text-muted">A smart account secured by your device's passkey. No seed phrase.</p>
          <div className="mt-2 flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name for a new passkey" className="!h-9 !text-[13px]" />
            <button
              disabled={!name || pk.busy}
              onClick={() => pk.register(name).then(onDone)}
              className="h-9 shrink-0 rounded-full bg-accent px-3 text-[12.5px] font-semibold text-white disabled:opacity-50"
            >
              Create
            </button>
          </div>
          <button disabled={pk.busy} onClick={() => pk.login().then(onDone)} className="mt-2 text-[12.5px] font-semibold text-accent hover:underline">
            Sign in with an existing passkey
          </button>
          {pk.error && <p className="mt-1.5 text-[12px] text-down">{pk.error}</p>}
        </div>
      )}
      {IS_LOCAL && local.length > 0 && (
        <div className="mt-1 border-t border-line pt-1">
          <div className="px-2.5 pb-1 pt-2 text-[12px] text-muted">Accounts</div>
          {personas.map((p, i) => (
            <MenuItem
              key={p.key}
              onClick={() => {
                connect({ connector: local[i] });
                onDone();
              }}
            >
              <span className="flex-1">{p.label}</span>
              <span className="text-[12px] text-muted">{p.role}</span>
            </MenuItem>
          ))}
        </div>
      )}
    </div>
  );
}

function WalletMenu() {
  const { address, kind } = useActiveAccount();
  const disconnect = useDisconnectAll();
  const { data: s } = useSnapshot();
  const personas = usePersonas();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useClickAway(open, () => setOpen(false));
  const label = personas.find((p) => p.address.toLowerCase() === address?.toLowerCase())?.label ?? short(address);
  const role = s?.user?.role ? ROLE_LABEL[s.user.role] : kind === "passkey" ? "Passkey" : null;

  if (!address) {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-[13.5px] font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          <Wallet className="size-4" aria-hidden />
          Connect
        </button>
        {open && <ConnectMenu onDone={() => setOpen(false)} />}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-canvas pl-1.5 pr-3 text-[13.5px] font-medium text-ink transition-colors hover:bg-soft"
      >
        <span className="size-6 rounded-full bg-[conic-gradient(from_200deg,#0f6b7d,#5fcbd9,#0b5463,#0f6b7d)]" aria-hidden />
        <span className="num">{label}</span>
        <ChevronDown className="size-3.5 text-muted" aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-72 overflow-hidden rounded-2xl border border-line bg-canvas shadow-[var(--shadow-float)]">
          <div className="border-b border-line px-4 py-3.5">
            <div className="flex items-center justify-between">
              <span className="num text-[13.5px] font-medium">{short(address)}</span>
              {role && <StatusPill tone="accent">{role}</StatusPill>}
            </div>
            <div className="num mt-1 text-[12.5px] text-muted">{usd(s?.user?.usdc ?? 0)} USDC</div>
          </div>
          <div className="p-1.5 text-[13.5px]">
            <MenuItem
              onClick={() => {
                void navigator.clipboard.writeText(address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? <Check className="size-4 text-up" /> : <Copy className="size-4 text-muted" />} {copied ? "Copied" : "Copy address"}
            </MenuItem>
            {EXPLORER && (
              <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer" className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 hover:bg-soft">
                <ExternalLink className="size-4 text-muted" /> View on explorer
              </a>
            )}
            <div className="mt-1 border-t border-line pt-1">
              <MenuItem onClick={() => (disconnect(), setOpen(false))}>
                <LogOut className="size-4 text-muted" /> Disconnect
              </MenuItem>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AppHeader() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-8 px-4 sm:px-6">
        <div className="flex h-16 items-center">
          <Wordmark />
        </div>
        <nav
          className="order-last -mx-4 flex w-[calc(100%+2rem)] gap-1 overflow-x-auto border-t border-line px-4 py-2 md:order-none md:mx-0 md:w-auto md:border-0 md:p-0"
          aria-label="Main"
        >
          {NAV.map(([href, label]) => {
            const active = path === href || path.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3.5 py-1.5 text-[14px] font-medium transition-colors ${active ? "bg-strong text-ink" : "text-muted hover:text-ink"}`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex h-16 items-center gap-2.5">
          <span className="hidden lg:inline-flex">
            <MarketStatus />
          </span>
          <Notices />
          <WalletMenu />
        </div>
      </div>
    </header>
  );
}

export function AppFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-[12.5px] text-muted sm:px-6">
        <span>© {new Date().getFullYear()} Bull Street. Testnet. Not an offer of securities.</span>
        <span>Every token is backed by a pledged share, the reserve or a broker's bond, enforced on-chain.</span>
      </div>
    </footer>
  );
}
