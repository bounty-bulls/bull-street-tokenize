/** Mirrors contracts/src/common/Types.sol and the exchange enums. */
export const Role = { None: 0, Minter: 1, Broker: 2 } as const;
export const Tier = { T1: 0, T2: 1, T3: 2 } as const;
export const BrokerStatus = { None: 0, Pending: 1, Active: 2, Draining: 3, Defaulted: 4, Exited: 5 } as const;
export const PledgeStatus = { None: 0, Pending: 1, Active: 2, Closed: 3, Rejected: 4 } as const;
export const Level = { Reserve: 0, Drain: 1, Volunteer: 2, AtRisk: 3, Normal: 4 } as const;
export const TicketClass = { Small: 0, Standard: 1, Large: 2 } as const;
export const TicketStatus = { None: 0, Batched: 1, PartiallyAllocated: 2, Allocated: 3, Done: 4 } as const;
export const AllocStatus = { None: 0, Assigned: 1, CurePending: 2, Cured: 3, Settled: 4, Defaulted: 5, ReservePaid: 6 } as const;
export const Side = { Buy: 0, Sell: 1 } as const;
export const OrderStatus = { None: 0, Open: 1, Filled: 2, Cancelled: 3, Expired: 4 } as const;

export const ROLE_LABEL = ["None", "Minter", "Broker"] as const;
export const TIER_LABEL = ["Tier 1", "Tier 2", "Tier 3"] as const;
export const BROKER_STATUS_LABEL = ["None", "Awaiting bond", "Active", "Draining", "Defaulted", "Exited"] as const;
export const PLEDGE_STATUS_LABEL = ["None", "Awaiting broker", "Active", "Closed", "Rejected"] as const;
export const LEVEL_LABEL = ["Reserve", "Draining broker", "Volunteer", "At risk", "Normal"] as const;
export const TICKET_CLASS_LABEL = ["Small (batched)", "Standard", "Large (split)"] as const;
export const TICKET_STATUS_LABEL = ["None", "Waiting for batch", "Partly assigned", "Assigned", "Paid"] as const;
export const ALLOC_STATUS_LABEL = ["None", "Waiting", "Cure pending", "Paid by minter", "Paid by broker", "Paid from bond", "Paid from reserve"] as const;
export const ORDER_STATUS_LABEL = ["None", "Open", "Filled", "Cancelled", "Expired"] as const;
