"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { BaseError, ContractFunctionRevertedError, type Abi, type Address } from "viem";
import { usePublicClient, useWalletClient } from "wagmi";
import type { Deployment } from "@bullstreet/shared";
import { api } from "./api";
import type { Snapshot } from "./types";
import { useActiveAccount, usePasskey } from "./wallet";

export function useDeployment() {
  return useQuery({ queryKey: ["deployment"], queryFn: () => api<Deployment>("/deployment"), staleTime: Infinity, retry: 2 });
}

/** Whole-protocol snapshot from the API, refreshed every 4 seconds and after every transaction. */
export function useSnapshot() {
  const { address } = useActiveAccount();
  return useQuery({
    queryKey: ["snapshot", address],
    queryFn: () => api<Snapshot>(`/snapshot${address ? `?wallet=${address}` : ""}`),
    refetchInterval: 4000,
    placeholderData: (prev) => prev,
  });
}

/** Seconds since epoch, ticking every second (for countdowns). */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const FRIENDLY: Record<string, string> = {
  ExceedsSpare: "That is more than the pledge's unminted shares",
  ExceedsFree: "That is more than the free backing",
  AttestationExpired: "The broker's attestation has expired; wait for it to be renewed",
  PriceStale: "Today's closing price has not been posted yet",
  PriceNotPosted: "The reference session's close is not posted yet",
  CapacityExceeded: "This broker has no capacity left for that pledge",
  TierMismatch: "This pledge's value belongs to a different broker tier",
  BrokerNotActive: "This broker is not taking new pledges",
  WholeSharesOnly: "Redeem whole shares only",
  CureWindowClosed: "The cure window has closed",
  CureWindowOpen: "The minter's cure window is still open",
  NotDue: "Not due yet",
  BelowMinFill: "Not enough orders at your price to fill the whole amount",
  OrderTooSmall: "Orders must be worth at least 1 USDC",
  Paused: "Trading in this stock is paused",
  RoleTaken: "This person already holds a role",
  BondBelowRequirement: "That would take the bond below its requirement",
  PledgeTooLarge: "Too large for one pledge; split it across brokers",
};

export function errorMessage(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = revert?.data?.errorName;
    if (name) return FRIENDLY[name] ?? name.replace(/([a-z])([A-Z])/g, "$1 $2");
    if (/User rejected|denied/i.test(e.shortMessage)) return "You rejected the request in your wallet";
    return e.shortMessage;
  }
  return (e as Error)?.message ?? String(e);
}

export interface TxRequest {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}

/** Simulate, send, wait; works for wallets (wagmi) and the passkey smart account. Refreshes the snapshot. */
export function useTx() {
  const client = usePublicClient();
  const { data: wallet } = useWalletClient();
  const { address, kind } = useActiveAccount();
  const pk = usePasskey();
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const send = useCallback(
    async (label: string, ...reqs: TxRequest[]) => {
      if (!client || !address) {
        setError("Connect a wallet first");
        return false;
      }
      setError(null);
      setPending(label);
      try {
        if (kind === "passkey" && pk) {
          for (const r of reqs) await client.simulateContract({ ...(r as object), account: address } as never);
          const hash = await pk.sendCalls(reqs.map((r) => ({ to: r.address, abi: r.abi, functionName: r.functionName, args: r.args })));
          setLastHash(hash);
        } else {
          if (!wallet) throw new Error("Connect a wallet first");
          for (const r of reqs) {
            const { request } = await client.simulateContract({ ...(r as object), account: address } as never);
            const hash = await wallet.writeContract(request as never);
            setLastHash(hash);
            const receipt = await client.waitForTransactionReceipt({ hash });
            if (receipt.status !== "success") throw new Error("Transaction reverted");
          }
        }
        await qc.invalidateQueries({ queryKey: ["snapshot"] });
        return true;
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setPending(null);
      }
    },
    [client, wallet, address, kind, pk, qc],
  );

  return { send, pending, error, setError, lastHash };
}

/** Reads an ERC-20 allowance; used to skip approvals that are already in place. */
export function useAllowanceCheck() {
  const client = usePublicClient();
  return useCallback(
    async (token: Address, owner: Address, spender: Address, need: bigint) => {
      if (!client) return false;
      const a = (await client.readContract({
        address: token,
        abi: [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] }],
        functionName: "allowance",
        args: [owner, spender],
      })) as bigint;
      return a >= need;
    },
    [client],
  );
}

export function short(a?: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

export function ago(ts: number, now: number): string {
  if (!ts) return "never";
  const s = now - ts;
  if (s < 0) return "just now";
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function until(ts: number, now: number): string {
  const s = ts - now;
  if (s <= 0) return "passed";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec.toString().padStart(2, "0")}s`;
  return `${sec}s`;
}
