/**
 * Wallets derived from DEMO_MNEMONIC (BIP-44 index) for seeding and the service keys.
 * Index 0 is unused so the deployer key stays separate.
 */
export const PERSONA_INDEX = {
  // service keys use indexes no other project key shares (the World attestor is a separate key)
  oracleA: 21,
  oracleB: 22,
  oracleC: 23,
  keeper: 24,
  brokerX: 5,
  brokerY: 6,
  brokerZ: 7,
  alice: 8,
  carol: 9,
  dev: 10,
  bob: 11,
  eve: 12,
  fay: 13,
  agentX: 14,
  agentY: 15,
  agentZ: 16,
} as const;

export type PersonaKey = keyof typeof PERSONA_INDEX;

export interface PersonaInfo {
  key: PersonaKey;
  label: string;
  role: "Minter" | "Broker" | "Holder" | "Service";
}

export const PERSONAS: PersonaInfo[] = [
  { key: "alice", label: "Alice", role: "Minter" },
  { key: "carol", label: "Carol", role: "Minter" },
  { key: "dev", label: "Dev", role: "Minter" },
  { key: "brokerX", label: "Northgate Securities", role: "Broker" },
  { key: "brokerY", label: "Banyan Pledge Services", role: "Broker" },
  { key: "brokerZ", label: "Tidewater Custody", role: "Broker" },
  { key: "bob", label: "Bob", role: "Holder" },
  { key: "eve", label: "Eve", role: "Holder" },
  { key: "fay", label: "Fay", role: "Holder" },
];
