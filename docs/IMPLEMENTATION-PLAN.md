# Bull Street: implementation plan and specification (as built)

> Companion to [CONTEXT.md](CONTEXT.md). This file is the technical specification of what is in the repository, the order it was built in, and how to deploy, operate and port it. Decisions are logged in [decisions.md](decisions.md).

## Contents
- A. Build plan and status
- B. Units, wiring and access
- C. Contracts
- D. EIP-712 messages
- E. Parameters
- F. Sessions and deadlines
- G. Events
- H. Services
- I. App
- J. Deploy, seed, operate
- K. Porting to Arc Studio
- L. Testing
- M. Not built

---

## A. Build plan and status

| Phase | Scope | Status |
|---|---|---|
| 0 | Repository, Foundry with OpenZeppelin 5.6 and forge-std (npm), pnpm workspace | Done |
| 1 | Foundation: types, errors, params, directory, EIP-712 base with nonce bitmaps and m-of-n signer threshold, `SessionClock`, `PriceOracle`, `Compliance`, `RoleRegistry`, `AssetFactory` and `StockToken` with corporate-action multiplier | Done |
| 2 | Brokers and pledges: `BondVault`, `BrokerRegistry` (tiers, capacity, health, states), `PledgeRegistry` (open, attest, mint, burn, re-attest with shortfall handling, stale slashing, release with penalty, migration, volunteers) | Done |
| 3 | Redemption: tickets with escrow, cure, settle with floor and late fees, default with partial cover and re-queue, reserve, all priced at the next session | Done |
| 4 | Multi-level queue: `LevelBook` (L1-L4 with exact aggregates), dispatcher with best fit, broker spreading, LRU, `MAX_SCAN`/`MAX_ALLOCS`, hints with level-order check, batching of small tickets, pre-emption on defaulted brokers, insolvency write-off | Done |
| 5 | `BullStreetExchange`: escrowed limit orders, partial fills, taker fee, default expiry at next open, reclaim | Done |
| 6 | Services: shared (ABIs, EIP-712, calendars, depository ledger, store), API (World ID, depository, planners, snapshot, notices, activity), workers (oracle, indexer and notifier, broker agents, keeper) | Done |
| 7 | App: landing, Markets, Trade, Mint, Broker, Redeem, Ops, Get started; browser, passkey and local wallets | Done |
| 8 | Deploy and seed scripts, end-to-end lifecycle script, Arc testnet deployment | Done |

---

## B. Units, wiring and access

| Quantity | Representation |
|---|---|
| Money | USDC, 6 decimals, ERC-20 interface only (never `msg.value`) |
| Price | USDC per share, 6 decimals |
| Ledger (q, m, a, ...) | Token units, 18 decimals |
| Shares | `StockToken.toShares(tokens) = tokens × mulNum / (mulDen × 1e18)`; starts 1:1; redemptions in whole shares |
| Ratios | Basis points (10,000 = 100%) |
| Time | `uint64` unix seconds |

**Wiring.** `Directory` holds every address. Contracts inherit `Wired`, which caches the directory's addresses locally (`refreshWiring()`, permissionless) instead of calling it on every lookup. Deploy order: Directory, Params, SessionClock, PriceOracle, Compliance, RoleRegistry, AssetFactory, BondVault, BrokerRegistry, LevelBook, PledgeRegistry, RedemptionEngine, BullStreetExchange; then `Directory.setAll`, `refreshWiring` on each, parameters, and `createAsset` × 3 (each token refreshes its own wiring).

| Caller | May call |
|---|---|
| PledgeRegistry | `StockToken.mint/burnFrom`, `BrokerRegistry.add/subExposure/markDefaulted/markDraining`, `BondVault.payFromBond`, `RedemptionEngine.addReserve` |
| RedemptionEngine | `StockToken.burnFrom`, `PledgeRegistry.onAllocate/onDeallocate/onCure/onSettle/onDefault/writeOffInsolvent/addUnbacked`, `BondVault.payFromBond`, `BrokerRegistry.markDefaulted` |
| BondVault | `BrokerRegistry.onBondChanged` |
| Owner (ops) | `Params.set`, `Compliance` flags, `AssetFactory.createAsset/applyCorporateAction`, signer sets |
| Anyone | `LevelBook.sync/requeueBroker`, `BrokerRegistry.poke`, `rejectExpired`, `slashStale`, `continueAllocation`, `processBatch`, `finalizeCure`, `claimReserve`, `claimDefault`, `reclaim` |

Admin is `Ownable2Step`; no proxies.

---

## C. Contracts

| Contract | Responsibility | Key functions |
|---|---|---|
| `SessionClock` | Contiguous sessions posted in 2-of-3 signed batches | `postSessions`, `isOpen`, `nextSessionIndex/Open`, `lastClosedSession`, `extendedClosure`, `deadlines(t)`, `closeAfterSessions(n)` |
| `PriceOracle` | One close per asset per closed session, 2-of-3 signed; history kept | `postBatch`, `closeOf`, `closeAt(asset, session)`, `isStale`, `freshClose` |
| `Compliance` | Denylist, global and per-asset pause, corporate-action freeze | `check`, `tradingPaused`, setters |
| `RoleRegistry` | One nullifier, one role | `register(RoleAttestation, sig)` |
| `AssetFactory` / `StockToken` | One ERC-20 per stock (`b` + ticker), protocol-only mint/burn, compliance on every transfer, shares-per-token multiplier | `createAsset`, `applyCorporateAction` (while frozen), `toTokens/toShares/valueOf` |
| `BondVault` | USDC bonds | `deposit`, `withdraw` (down to the requirement; all once exited), `payFromBond` |
| `BrokerRegistry` | Tiers, status, exposure per asset, capacity, health | `join`, `setDelegate`, `setDraining`, `exit`, `poke`, `tierFor` |
| `LevelBook` | Queue membership and free backing per level | `sync`, `syncMany`, `requeueBroker`, `free`, `members` |
| `PledgeRegistry` | The ledger | `openPledge`, `cancelPending`, `rejectExpired`, `attestPledge`, `reattest`, `mint`, `burnAgainst`, `setVolunteer`, `slashStale`, `requestRelease`, `confirmRelease`, `claimReleasePenalty`, `migrate`, redemption hooks |
| `RedemptionEngine` | Tickets, dispatcher, batches, reserve, payouts | `requestRedemption(asset, units, hint)`, `continueAllocation`, `processBatch`, `claimBatch`, `cure`, `finalizeCure`, `settle(SaleReport, sig)`, `claimDefault`, `claimReserve`, `sweepReserve` |
| `BullStreetExchange` | Peer-to-peer order book | `trade(TradeParams)`, `cancel`, `reclaim`, `openOrders`, `ordersOf` |

**Opening a pledge** requires the minter role, an Active broker of exactly the tier the pledge's value falls in, enough broker capacity, a fresh price and an unfrozen asset. Exposure is reserved at opening and released on rejection, release, settlement or default.

**Attesting** requires the broker's or its delegate's signature (EIP-1271 accepted), the exact quantity, the asset's ISIN hash, an unused PSN hash and a validity of at most `ATTEST_TTL`.

**Minting** requires an Active pledge with a live attestation, an Active broker, a fresh close, and `units + pendingRelease ≤ q − m`.

**Exchange `trade`** walks `fillIds` (best price first, supplied by the app), skips closed, expired, same-side, other-asset and worse-priced orders, fills at each resting order's price, enforces `minFilled`, then rests the remainder at `limitPrice` if `rest`. Buy escrow is rounded up; taker payouts rounded down; leftover escrow is refunded when an order closes.

---

## D. EIP-712 messages
Domain `{ name: "Bull Street", version: "1", chainId, verifyingContract }`. Nonces are per-signer bitmaps (oracle batches use the contract's own address as the signer key).

```
RoleAttestation(address wallet,uint8 role,bytes32 nullifierHash,uint64 expiry,uint256 nonce)            RoleRegistry, World attestor
PledgeAttestation(uint256 pledgeId,bytes32 psnHash,bytes32 isinHash,uint256 quantity,address minter,uint64 validUntil,uint256 nonce)   PledgeRegistry, broker or delegate
ReleaseConfirmation(uint256 pledgeId,uint256 quantity,uint256 nonce)                                   PledgeRegistry, broker or delegate
SaleReport(uint256 allocationId,uint256 quantity,uint256 grossProceeds,uint64 saleTime,uint256 nonce)  RedemptionEngine, broker or delegate
PriceBatch(uint32 sessionIndex,uint32[] assetIds,uint256[] closes,uint64 asOf,uint256 nonce)           PriceOracle, 2 of 3 signers (ascending)
SessionBatch(SessionInfo[] sessions,uint256 nonce) / SessionInfo(uint32 sessionIndex,uint64 openTime,uint64 closeTime)   SessionClock, 2 of 3 signers
```
Mirrored in `services/shared/src/eip712.ts`.

---

## E. Parameters
Owner-settable in `Params` (`set`, `setMany`). Compressed-calendar values are applied by the deploy script.

| Key | NSE value | Compressed |
|---|---|---|
| TIER_CAP_1/2/3 | 2,000 / 20,000 / 200,000 USDC | ÷ DEMO_SCALE |
| MIN_BOND_1/2/3 | 2,200 / 22,000 / 220,000 USDC | ÷ DEMO_SCALE |
| BOND_BPS / BOND_BPS_EXT | 11,000 / 12,500 | same |
| ATRISK_HEALTH_BPS / CURE_HEALTH_BPS | 12,000 / 10,000 | same |
| HEALTH_CURE | 24 h | 20 min |
| MINT_FEE_BPS / REDEEM_FEE_BPS / VOLUNTEER_REBATE_BPS / BROKER_FEE_SHARE_BPS | 10 / 20 / 5 / 5,000 | same |
| FLOOR_BPS / DEFAULT_BONUS_BPS / LATE_FEE_BPS | 9,900 / 500 / 10 per session | same |
| SMALL_MAX / MAX_SCAN / MAX_ALLOCS | 10 shares / 50 / 8 | same |
| CURE_GRACE / CURE_ESCROW_BPS | 1 h / 12,000 | 3 min |
| SOFT_SESSIONS / HARD_SESSIONS | 2 / 3 | same |
| ATTEST_TTL / ATRISK_WINDOW / STALE_GRACE | 7 d / 48 h / 3 d | 2 h / 30 min / 30 min |
| RELEASE_SESSIONS / RELEASE_PENALTY_BPS | 2 / 50 | same |
| PENDING_PLEDGE_TTL / EXT_CLOSURE | 15 d / 3 d | 2 h / 45 min |
| TAKER_FEE_BPS / MAX_ORDER_TTL / MIN_ORDER_VALUE | 10 / 30 d / 1 USDC | 1 d |

---

## F. Sessions and deadlines
- `isOpen()`: a session with `open ≤ now < close`.
- `nextSessionIndex()`: the first session opening strictly after now (during a session, the one after it).
- `lastClosedSession()`: the latest session with `close ≤ now`.
- `extendedClosure()`: closed and the next open is more than `EXT_CLOSURE` away.
- `deadlines(t)`: `refSession = c` = first session opening after `t`; `cure = min(open(c) + CURE_GRACE, close(c))`; `soft = close(c + SOFT_SESSIONS)`; `hard = close(c + HARD_SESSIONS)`.
- A price is stale when its session is older than the last closed session.
- Late fees accrue per closed session after the soft session.

Calendars (`services/shared/src/calendar.ts`): NSE sessions 09:15-15:30 IST on weekdays that are not 2026 exchange holidays; compressed sessions of 10 minutes with 20-minute gaps and an 80-minute gap after every fifth. Both bootstrap with one already-closed session so a price can be posted immediately.

---

## G. Events
Indexed by the workers into SQLite (`events` table): `RoleRegistered`, `BrokerJoined`, `BrokerStatusChanged`, `Bond*`, `PledgeOpened`, `PledgeAttested`, `PledgeReattested`, `Shortfall`, `Minted`, `BurnedAgainst`, `VolunteerSet`, `StaleSlashed`, `BondSettled`, `Release*`, `Migrated`, `WrittenOff`, `TicketCreated`, `BatchJoined`, `BatchProcessed`, `AllocationCreated`, `CureStarted`, `Cured`, `Settled`, `DefaultClaimed`, `ReservePaid`, `BatchClaimed`, `TicketDone`, `ReserveAdded`, `Requeued`, `OrderPlaced`, `OrderFilled`, `OrderClosed`, `PriceUpdated`, `SessionsPosted`, compliance and parameter events.

---

## H. Services

### H.1 API (`services/api`, Hono, port 8790)
| Route | Purpose |
|---|---|
| `GET /snapshot?wallet=` | Everything the app shows in one read: calendar, params, assets (supply, backing, reserve, unbacked, close, order book, queue levels, batch), brokers, pledges, and the wallet's balances, tickets with allocations, orders and duties |
| `POST /world/rp-context` | Signs the IDKit 4 RP request |
| `POST /world/verify` | Verifies the proof with the Developer Portal, checks environment, action, Proof of Human and the signal (`role, wallet`), uniqueness; returns a signed `RoleAttestation`; `409 ROLE_TAKEN` |
| `POST /world/dev` | Role without a scan (local chains or `ALLOW_DEV_IDENTITY`) |
| `/dep/*` | Link a demat account, list holdings, create the depository pledge for an on-chain pledge, guided Easiest instructions and PSN reporting, broker BO ID publishing, signed pledgee actions (confirm, invoke, release), inbox |
| `POST /plan/pledge` | Shards a holding across eligible brokers |
| `POST /plan/allocation` | Simulates the dispatcher; returns the steps and a hint |
| `GET /notices/:wallet`, `POST /notices/:wallet/read` | In-app notifications |
| `GET /activity`, `GET /activity/trades/:asset` | Indexed events |
| `GET /personas`, `GET /deployment`, `GET /health` | Helpers |

### H.2 Workers (`services/workers`)
| Job | Every | Does |
|---|---|---|
| indexer | 4 s | Indexes all contract events; writes notices (pledge active, redemption assigned, payouts, fills, releases, broker status) |
| oracle | 15 s | Keeps 24 future sessions posted; after each close posts every asset's close (Twelve Data, then Yahoo; USD/INR median), signed 2 of 3 |
| brokers | 15 s | For each broker with a delegate key: attests accepted pledges, invokes and sells after the cure deadline and settles once the close is posted, unpledges and confirms releases, re-attests before half the TTL is used |
| keeper | 30 s | Depository processing (business days, 15-day rejection), batches, continuing tickets, finalising cures, reserve payouts, default claims, health pokes when needed, requeues, at-risk syncs, pending expiry, stale slashing, reclaiming expired orders |

Workers use chain time (latest block timestamp, never behind wall time).

### H.3 Store
SQLite (WAL, shared by API and workers): `world_roles`, `broker_profiles`, `dep_accounts`, `dep_holdings`, `dep_pledges`, `dep_inbox`, `notices`, `events`, `kv`.

---

## I. App (`app/`, Next.js 16, Tailwind 4, wagmi, IDKit 4, Circle Modular Wallets)

| Route | For | Shows |
|---|---|---|
| `/` | Everyone | Hero, live session strip, live markets, how it works, backing, roles, guarantees |
| `/markets` | Everyone | Stocks (market price, NSE close, premium, best bid/ask, backing), brokers (bond, exposure, coverage, capacity), redemption queue levels, activity |
| `/trade` | Traders | Order book with depth, ticket (limit or instant, expiry), recent trades, your orders |
| `/mint` | Minters (World ID) | Redemptions to cure, demat account, pledge planner (connected or Easiest), pledge cards (mint, burn, release, move, volunteer, list for sale, penalty) |
| `/broker` | Brokers (World ID) | Register, status and coverage, bond, redemptions to settle, pledges to confirm, active pledges (re-attest, release), desk key, drain, exit |
| `/redeem` | Holders | Request with queue preview and estimate, redemptions with payout path, deadlines and claims |
| `/ops` | Operator | Sessions, prices, trading controls and corporate actions, upkeep, parameters, contracts |
| `/onboard` | Everyone | Choosing a role |

Wallets: any browser wallet; a Circle passkey smart account (when the client key is set) for trading and redeeming; seeded accounts on a local chain. No mock or demo labels appear in the UI.

---

## J. Deploy, seed, operate
```bash
pnpm deploy:arc     # scripts/deploy.ts -> contracts/script/Deploy.s.sol; writes deploy/5042002/addresses.json
pnpm seed           # scripts/seed.ts: funds service keys and personas, roles, brokers (bond = 1.3 × tier minimum), demat accounts, pledges, attestations, mints, orders
pnpm api; pnpm workers; pnpm dev
```
- **Keys:** `DEPLOYER_PRIVATE_KEY` (owner, treasury, funds the seed); `DEMO_MNEMONIC` indexes 21-23 oracle signers, 24 keeper, 5-7 brokers, 14-16 their desk keys, 8-10 minters, 11-13 holders; `WORLD_ATTESTOR_PRIVATE_KEY` (separate).
- **Costs on Arc:** deployment about 1.1 USDC of gas; oracle and keeper a few cents an hour; bonds dominate seeding.
- **Scaling:** tier caps and bonds are parameters; raise them from `/ops` once more USDC is available.

---

## K. Porting to Arc Studio
The repository is a standard Foundry project plus a pnpm workspace, so Arc Studio's agent can take it as is:
1. Clone the public repository into Studio.
2. In `contracts/`: `pnpm install` (OpenZeppelin and forge-std come from npm), `forge build`, `forge test`.
3. Deploy with `contracts/script/Deploy.s.sol` (env: `USDC_ADDRESS=0x3600…0000`, `WORLD_ATTESTOR_ADDRESS`, `ORACLE_SIGNERS`, `CALENDAR_MODE=compressed`, `DEMO_SCALE`), or keep the existing deployment in `deploy/5042002/addresses.json`.
4. Point the app at the deployment (`NEXT_PUBLIC_CHAIN_ID=5042002`, `NEXT_PUBLIC_API_URL`) and run the API and workers next to it.
Contract sizes stay under the 24 KB limit (`RedemptionEngine` is the largest at about 24.0 KB with `optimizer_runs = 50`).

---

## L. Testing
- **Contracts (54 tests):** foundation (roles, clock, oracle, token, compliance), brokers and pledges, redemption (weekend crash and rally, floor, cure window, default with full and short bonds, level order, hints, rebate, partial allocation, reserve, batching), exchange (escrow, fills, rounding, expiry, min fill, pauses), scenarios (the eight-step worked ledger; a week in the life), fuzzed invariants (backing I1/I2 and exchange escrow).
- **Services:** calendar tests (`services/shared`).
- **End to end:** `scripts/e2e.ts` runs buy → settle → cure → batch → default on anvil with time warps and checks backing after each step.

---

## M. Not built
zkEmail proof of CDSL alert emails; a fresh World ID check before bond withdrawals; cross-chain USDC deposits (Bridge Kit/Gateway); Uniswap integration; an off-chain order book.
