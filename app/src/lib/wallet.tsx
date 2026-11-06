"use client";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPublicClient, http, type Abi, type Address, type Transport } from "viem";
import { createBundlerClient, toWebAuthnAccount, type BundlerClient } from "viem/account-abstraction";
import { WagmiProvider, createConfig, useAccount, useDisconnect } from "wagmi";
import { injected, mock } from "wagmi/connectors";
import {
  WebAuthnMode,
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
  type WebAuthnCredential,
} from "@circle-fin/modular-wallets-core";
import { CIRCLE, IS_LOCAL, PASSKEY_ENABLED, RPC_URL, chain } from "./config";
import { api } from "./api";
import type { Persona } from "./types";

// ---------------------------------------------------------------- passkey wallet (Circle Modular Wallets)

interface PasskeyState {
  address?: Address;
  username?: string;
  busy: boolean;
  error?: string;
  register: (username: string) => Promise<void>;
  login: () => Promise<void>;
  logout: () => void;
  sendCalls: (calls: { to: Address; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[] }[]) => Promise<string>;
}

const PasskeyContext = createContext<PasskeyState | null>(null);
const STORE = "bullstreet.passkey";

function PasskeyProvider({ children }: { children: ReactNode }) {
  const [bundler, setBundler] = useState<BundlerClient | null>(null);
  const [address, setAddress] = useState<Address>();
  const [username, setUsername] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const connect = useCallback(async (credential: WebAuthnCredential, name?: string) => {
    const modular = toModularTransport(`${CIRCLE.clientUrl}/arcTestnet`, CIRCLE.clientKey);
    const client = createPublicClient({ chain, transport: modular });
    const account = await toCircleSmartAccount({ client, owner: toWebAuthnAccount({ credential }) });
    setBundler(createBundlerClient({ account, chain, transport: modular }) as unknown as BundlerClient);
    setAddress(account.address);
    setUsername(name);
    try {
      localStorage.setItem(STORE, JSON.stringify({ credential, username: name }));
    } catch {}
  }, []);

  useEffect(() => {
    if (!PASSKEY_ENABLED) return;
    try {
      const saved = localStorage.getItem(STORE);
      if (saved) {
        const { credential, username: name } = JSON.parse(saved);
        void connect(credential, name).catch(() => localStorage.removeItem(STORE));
      }
    } catch {}
  }, [connect]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const value: PasskeyState = {
    address,
    username,
    busy,
    error,
    register: (name) =>
      run(async () => {
        const transport = toPasskeyTransport(CIRCLE.clientUrl, CIRCLE.clientKey);
        const credential = await toWebAuthnCredential({ transport, mode: WebAuthnMode.Register, username: name });
        await connect(credential, name);
      }),
    login: () =>
      run(async () => {
        const transport = toPasskeyTransport(CIRCLE.clientUrl, CIRCLE.clientKey);
        const credential = await toWebAuthnCredential({ transport, mode: WebAuthnMode.Login });
        await connect(credential);
      }),
    logout: () => {
      setBundler(null);
      setAddress(undefined);
      try {
        localStorage.removeItem(STORE);
      } catch {}
    },
    sendCalls: async (calls) => {
      if (!bundler) throw new Error("Passkey wallet not connected");
      const send = (paymaster: boolean) =>
        bundler.sendUserOperation({ calls: calls as any, ...(paymaster ? { paymaster: true } : {}) } as any);
      let hash: `0x${string}`;
      try {
        hash = await send(true);
      } catch {
        hash = await send(false); // no gas sponsorship: the account pays gas in USDC
      }
      const { receipt } = await bundler.waitForUserOperationReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      return receipt.transactionHash;
    },
  };
  return <PasskeyContext.Provider value={value}>{children}</PasskeyContext.Provider>;
}

export function usePasskey() {
  return useContext(PasskeyContext);
}

// ---------------------------------------------------------------- wagmi (injected wallets; local accounts on anvil)

function buildConfig(personas: Persona[]) {
  const local = IS_LOCAL ? personas.map((p) => mock({ accounts: [p.address], features: { reconnect: true } })) : [];
  return createConfig({
    chains: [chain],
    connectors: [injected(), ...local],
    transports: { [chain.id]: http(RPC_URL) } as Record<number, Transport>,
    ssr: true,
  });
}

const PersonaContext = createContext<Persona[]>([]);
export const usePersonas = () => useContext(PersonaContext);

function WalletLayer({ children }: { children: ReactNode }) {
  const { data: personas } = useQuery({ queryKey: ["personas"], queryFn: () => api<Persona[]>("/personas"), staleTime: Infinity, retry: 1 });
  const ready = !IS_LOCAL || personas !== undefined;
  const config = useMemo(() => (ready ? buildConfig(personas ?? []) : null), [ready, personas]);
  if (!config) return null;
  return (
    <PersonaContext.Provider value={personas ?? []}>
      <WagmiProvider config={config}>{PASSKEY_ENABLED ? <PasskeyProvider>{children}</PasskeyProvider> : children}</WagmiProvider>
    </PersonaContext.Provider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={qc}>
      <WalletLayer>{children}</WalletLayer>
    </QueryClientProvider>
  );
}

/** The active account: an injected or local wallet through wagmi, or the passkey smart account. */
export function useActiveAccount(): { address?: Address; kind: "wallet" | "passkey" | null } {
  const { address } = useAccount();
  const pk = usePasskey();
  if (address) return { address, kind: "wallet" };
  if (pk?.address) return { address: pk.address, kind: "passkey" };
  return { kind: null };
}

export function useDisconnectAll() {
  const { disconnect } = useDisconnect();
  const pk = usePasskey();
  return () => {
    disconnect();
    pk?.logout();
  };
}
