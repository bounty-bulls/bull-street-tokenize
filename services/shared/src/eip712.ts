import type { Address, Hex } from "viem";

/** EIP-712 domain and types. Mirrors contracts/src/common/Attestations.sol (name "Bull Street", version "1"). */
export const domain = (chainId: number, verifyingContract: Address) =>
  ({ name: "Bull Street", version: "1", chainId, verifyingContract }) as const;

export const roleAttestationTypes = {
  RoleAttestation: [
    { name: "wallet", type: "address" },
    { name: "role", type: "uint8" },
    { name: "nullifierHash", type: "bytes32" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const pledgeAttestationTypes = {
  PledgeAttestation: [
    { name: "pledgeId", type: "uint256" },
    { name: "psnHash", type: "bytes32" },
    { name: "isinHash", type: "bytes32" },
    { name: "quantity", type: "uint256" },
    { name: "minter", type: "address" },
    { name: "validUntil", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const releaseConfirmationTypes = {
  ReleaseConfirmation: [
    { name: "pledgeId", type: "uint256" },
    { name: "quantity", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const saleReportTypes = {
  SaleReport: [
    { name: "allocationId", type: "uint256" },
    { name: "quantity", type: "uint256" },
    { name: "grossProceeds", type: "uint256" },
    { name: "saleTime", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const priceBatchTypes = {
  PriceBatch: [
    { name: "sessionIndex", type: "uint32" },
    { name: "assetIds", type: "uint32[]" },
    { name: "closes", type: "uint256[]" },
    { name: "asOf", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const sessionBatchTypes = {
  SessionBatch: [
    { name: "sessions", type: "SessionInfo[]" },
    { name: "nonce", type: "uint256" },
  ],
  SessionInfo: [
    { name: "sessionIndex", type: "uint32" },
    { name: "openTime", type: "uint64" },
    { name: "closeTime", type: "uint64" },
  ],
} as const;

export interface RoleAttestation {
  wallet: Address;
  role: number;
  nullifierHash: Hex;
  expiry: bigint;
  nonce: bigint;
}

export interface PledgeAttestation {
  pledgeId: bigint;
  psnHash: Hex;
  isinHash: Hex;
  quantity: bigint;
  minter: Address;
  validUntil: bigint;
  nonce: bigint;
}

export interface SaleReport {
  allocationId: bigint;
  quantity: bigint;
  grossProceeds: bigint;
  saleTime: bigint;
  nonce: bigint;
}

/** Random 64-bit nonce (contracts use per-signer bitmaps, so any unused value works). */
export function randomNonce(): bigint {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return b.reduce((acc, x) => (acc << 8n) | BigInt(x), 0n);
}
