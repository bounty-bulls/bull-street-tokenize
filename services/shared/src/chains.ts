import { defineChain } from "viem";
import { arcTestnet as viemArcTestnet } from "viem/chains";

/** Arc testnet: USDC is the gas token (18 decimals natively; its ERC-20 interface uses 6). */
export const arcTestnet = viemArcTestnet;
export const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;

export const localChain = defineChain({
  id: 31337,
  name: "Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 0 } },
});

export const chainById = (id: number) => (id === arcTestnet.id ? arcTestnet : localChain);
