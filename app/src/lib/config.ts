import { arcTestnet, localChain } from "@bullstreet/shared";

/** Client-visible configuration (NEXT_PUBLIC_*). */
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
export const IS_LOCAL = CHAIN_ID === 31337;
export const chain = IS_LOCAL ? localChain : arcTestnet;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? (IS_LOCAL ? "http://127.0.0.1:8545" : "https://rpc.testnet.arc.network");
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8790";
export const EXPLORER = IS_LOCAL ? undefined : "https://testnet.arcscan.app";

export const WORLD = {
  appId: process.env.NEXT_PUBLIC_WORLD_APP_ID ?? "",
  rpId: process.env.NEXT_PUBLIC_WORLD_RP_ID ?? "",
  env: (process.env.NEXT_PUBLIC_WORLD_ENV ?? "staging") as "staging" | "production",
  action: process.env.NEXT_PUBLIC_WORLD_ACTION ?? "bullstreet-role-v1",
};
export const WORLD_ENABLED = WORLD.appId.startsWith("app_") && WORLD.rpId.length > 0;

export const CIRCLE = {
  clientKey: process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY ?? "",
  clientUrl: process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL ?? "",
};
export const PASSKEY_ENABLED = !IS_LOCAL && CIRCLE.clientKey.length > 0 && CIRCLE.clientUrl.length > 0;
