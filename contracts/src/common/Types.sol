// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Shared enums and structs. Ledger quantities (q, m, a, ...) are in token units (18 decimals);
///         a per-asset multiplier in StockToken converts them to real shares. Money is USDC with 6 decimals.

enum Role {
    None,
    Minter,
    Broker
}

enum Tier {
    T1,
    T2,
    T3
}

enum BrokerStatus {
    None,
    Pending,
    Active,
    Draining,
    Defaulted,
    Exited
}

enum PledgeStatus {
    None,
    Pending,
    Active,
    Closed,
    Rejected
}

/// @dev L0..L4. A redemption is served from a level only when every higher level is empty.
enum Level {
    Reserve,
    Drain,
    Volunteer,
    AtRisk,
    Normal
}

enum TicketClass {
    Small,
    Standard,
    Large
}

enum TicketStatus {
    None,
    Batched,
    PartiallyAllocated,
    Allocated,
    Done
}

enum AllocStatus {
    None,
    Assigned,
    CurePending,
    Cured,
    Settled,
    Defaulted,
    ReservePaid
}

struct Broker {
    Tier tier;
    BrokerStatus status;
    bytes32 boIdHash;
    address delegate;
    uint64 joinedAt;
    uint64 healthLowSince; // 0 while healthy
}

struct Pledge {
    address minter;
    address broker;
    uint32 assetId;
    Tier tier;
    PledgeStatus status;
    bool volunteer;
    bool releasePenaltyPaid;
    bool guided; // pledged by the owner in CDSL Easiest rather than through a connected account
    bytes32 psnHash;
    uint64 openedAt;
    uint64 attestedUntil;
    uint64 releaseDeadline;
    uint256 q; // pledged and not invoked
    uint256 m; // tokens outstanding backed by this pledge
    uint256 a; // part of m assigned to open redemption allocations
    uint256 pendingRelease;
    uint256 invoked;
    uint256 cured;
    uint256 released;
    uint256 bondSettled;
}

struct Ticket {
    address holder;
    uint32 assetId;
    TicketClass cls;
    TicketStatus status;
    uint32 openAllocs;
    uint64 requestedAt;
    uint256 units; // total tokens escrowed
    uint256 remaining; // tokens not yet assigned to an allocation
    uint256 paid; // USDC paid to the holder (or to the batch pot) so far
    uint256 batchId; // non-zero for small tickets and for the aggregate ticket of a batch
}

struct Allocation {
    uint256 ticketId;
    uint256 pledgeId; // 0 = reserve
    uint256 units;
    AllocStatus status;
    bool volunteer; // pledge was a volunteer when allocated (rebate)
    uint32 refSession; // first session after the request; its close prices every payout
    uint32 softSession;
    uint32 hardSession;
    uint64 cureDeadline;
    uint64 softDeadline;
    uint64 hardDeadline;
    uint256 cureEscrow;
    uint256 paid;
}

struct Deadlines {
    uint32 refSession;
    uint32 softSession;
    uint32 hardSession;
    uint64 cure;
    uint64 soft;
    uint64 hard;
}
