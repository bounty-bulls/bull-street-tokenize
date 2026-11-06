"use client";

import { ASSETS } from "@bullstreet/shared";
import { AssetMark } from "./ui";

/** Compact asset switcher (pill tabs) for workspaces with a handful of listed stocks. */
export function AssetTabs({ value, onChange }: { value: number; onChange: (id: number) => void }) {
  return (
    <div role="tablist" aria-label="Stock" className="flex flex-wrap gap-2">
      {ASSETS.map((a) => {
        const on = a.id === value;
        return (
          <button
            key={a.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(a.id)}
            className={`inline-flex h-10 items-center gap-2 rounded-full border pl-1.5 pr-4 text-[13.5px] font-semibold transition-colors ${
              on ? "border-ink bg-canvas text-ink" : "border-line bg-canvas text-body hover:border-[#cfd3d9]"
            }`}
          >
            <AssetMark assetId={a.id} size={28} />
            {a.ticker}
          </button>
        );
      })}
    </div>
  );
}

export function AssetSelect({ value, onChange }: { value: number; onChange: (id: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {ASSETS.map((a) => (
        <option key={a.id} value={a.id}>
          {a.ticker} · {a.symbol}
        </option>
      ))}
    </select>
  );
}
