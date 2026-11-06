import type { Address } from "viem";

/** Shape of deploy/<chainId>/addresses.json written by contracts/script/Deploy.s.sol. */
export interface Deployment {
  chainId: number;
  deployBlock: number;
  calendarMode: "nse" | "compressed";
  demoScale: number;
  owner: Address;
  treasury: Address;
  worldAttestor: Address;
  oracleSigners: Address[];
  oracleThreshold: number;
  usdc: Address;
  directory: Address;
  params: Address;
  sessionClock: Address;
  priceOracle: Address;
  compliance: Address;
  roles: Address;
  assets: Address;
  bondVault: Address;
  brokers: Address;
  levelBook: Address;
  pledges: Address;
  redemption: Address;
  exchange: Address;
  tokens: Address[];
}
