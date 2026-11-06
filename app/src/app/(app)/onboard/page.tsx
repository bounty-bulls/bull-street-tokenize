"use client";

import Link from "next/link";
import { ArrowUpRight, Building2, Coins, LineChart } from "lucide-react";
import { ROLE_LABEL } from "@bullstreet/shared";
import { PageHeader, StatusPill } from "@/components/ui";
import { useSnapshot } from "@/lib/hooks";

const CHOICES = [
  {
    href: "/mint",
    icon: Coins,
    title: "I own shares",
    body: "Pledge shares from your demat account and mint tokens against them. Needs a one-time World ID check: one person, one role.",
    cta: "Become a minter",
  },
  {
    href: "/broker",
    icon: Building2,
    title: "I run a pledge desk",
    body: "Accept pledges into your CDSL account, post a USDC bond and settle redemptions on NSE. Needs a one-time World ID check.",
    cta: "Become a broker",
  },
  {
    href: "/trade",
    icon: LineChart,
    title: "I want to trade",
    body: "Buy and sell tokens on the order book and redeem them for USDC. No verification needed; a passkey wallet works.",
    cta: "Open the order book",
  },
];

export default function OnboardPage() {
  const { data: s } = useSnapshot();
  const role = s?.user?.role ?? 0;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Get started"
        description="Choose how you will use Bull Street. Minters and brokers verify with World ID so the two sides of every pledge are different people."
        actions={role ? <StatusPill tone="accent">Registered as {ROLE_LABEL[role].toLowerCase()}</StatusPill> : undefined}
      />
      <div className="grid gap-4 md:grid-cols-3">
        {CHOICES.map((c) => (
          <Link key={c.href} href={c.href} className="group flex flex-col rounded-2xl border border-line bg-canvas p-6 transition-colors hover:border-[#cfd3d9]">
            <span className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent">
              <c.icon className="size-5" aria-hidden />
            </span>
            <h2 className="mt-4 text-[18px] font-semibold text-ink">{c.title}</h2>
            <p className="mt-2 flex-1 text-[14px] leading-relaxed text-body">{c.body}</p>
            <span className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-semibold text-accent">
              {c.cta}
              <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
