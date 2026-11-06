import type { Address } from "viem";

/** Shapes returned by the API's /snapshot (all big numbers as decimal strings). */
export interface BookOrder {
  id: string;
  maker: Address;
  side: number;
  price: string;
  remaining: string;
  expiry: number;
}

export interface AssetView {
  id: number;
  isin: string;
  ticker: string;
  name: string;
  symbol: string;
  yahoo: string;
  token: Address;
  supply: string;
  totalM: string;
  unbacked: string;
  reserve: { units: string; free: string; cash: string };
  close: string;
  closeSession: number;
  asOf: number;
  stale: boolean;
  lastTradePrice: string;
  bids: BookOrder[];
  asks: BookOrder[];
  levels: { drain: string; volunteer: string; atRisk: string; normal: string };
  batch: { id: string; session: number; units: string } | null;
  sharesPerToken: string;
  paused: boolean;
  frozen: boolean;
}

export interface BrokerView {
  address: Address;
  name: string;
  tier: number;
  status: number;
  delegate: Address;
  healthLowSince: number;
  bond: string;
  exposure: string;
  capacity: string;
  required: string;
  health: string | null;
  pledgeCount: number;
  boId: string | null;
}

export interface PledgeView {
  id: string;
  minter: Address;
  broker: Address;
  assetId: number;
  tier: number;
  status: number;
  volunteer: boolean;
  guided: boolean;
  openedAt: number;
  attestedUntil: number;
  releaseDeadline: number;
  releasePenaltyPaid: boolean;
  q: string;
  m: string;
  a: string;
  pendingRelease: string;
  invoked: string;
  cured: string;
  released: string;
  bondSettled: string;
  level: number;
  inQueue: boolean;
}

export interface AllocationView {
  id: string;
  ticketId: string;
  assetId: number;
  holder?: Address;
  pledgeId: string;
  units: string;
  status: number;
  volunteer: boolean;
  refSession: number;
  softSession: number;
  hardSession: number;
  cureDeadline: number;
  softDeadline: number;
  hardDeadline: number;
  cureEscrow: string;
  paid: string;
  refClose: string;
}

export interface TicketView {
  id: string;
  assetId: number;
  cls: number;
  status: number;
  units: string;
  remaining: string;
  paid: string;
  requestedAt: number;
  openAllocs: number;
  batch: { id: string; session: number; processed: boolean; units: string; aggTicket: string } | null;
  allocations: AllocationView[];
}

export interface OrderView {
  id: string;
  assetId: number;
  side: number;
  status: number;
  price: string;
  amount: string;
  remaining: string;
  usdcEscrow: string;
  createdAt: number;
  expiry: number;
}

export interface Session {
  index: number;
  open: number;
  close: number;
}

export interface Snapshot {
  chainId: number;
  block: number;
  time: number;
  calendar: {
    mode: "nse" | "compressed";
    open: boolean;
    extendedClosure: boolean;
    count: number;
    lastClosed: number | null;
    current?: Session;
    next?: Session;
    sessions: Session[];
  };
  params: Record<string, string>;
  assets: AssetView[];
  brokers: BrokerView[];
  pledges: PledgeView[];
  user: null | {
    address: Address;
    role: number;
    usdc: string;
    balances: Record<string, string>;
    tickets: TicketView[];
    orders: OrderView[];
    duties: AllocationView[];
  };
}

export interface Persona {
  key: string;
  label: string;
  role: string;
  address: Address;
}
