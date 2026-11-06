# Decision log

One row per decision: date · topic · decision · why.

| Date (IST) | Topic | Decision | Why |
|---|---|---|---|
| 2026-11-06 | Product name | **Bull Street**. Token names `Bull Street <Company>`, symbols `b` + ticker (`bRELIANCE`, `bTCS`, `bINFY`) | Team decision |
| 2026-11-06 | Chain and money | Arc testnet (chain 5042002). USDC through its ERC-20 interface `0x3600…0000` with 6 decimals. Never `msg.value` or native balances | Arc settles and pays gas in USDC |
| 2026-11-06 | Identity | World ID Proof of Human, one action `bullstreet-role-v1` for both roles, so one person holds one role. Verified on the server, then an EIP-712 role attestation on-chain | Minimum assurance that keeps minter and broker independent |
| 2026-11-06 | Trading | **Peer-to-peer order book** (`BullStreetExchange`): makers post limit orders with escrow, takers fill them. No AMM, no pool, no liquidity providers. The platform never sets a trading price | Prices come only from people's orders (supply and demand) |
| 2026-11-06 | Other venues | No Uniswap integration. Tokens are standard ERC-20s, so any venue can list them | Out of scope for the product |
| 2026-11-06 | Redemption pricing | Every payout path (reserve, cure, broker sale, default) is priced at the close of the **first session after the request** (`refSession`), never at the last close | Pricing at the last close gives traders a free option on news that breaks while NSE is closed and drains brokers |
| 2026-11-06 | Ledger units | Pledge ledger (Q, M, A) is kept in token units (18 decimals). A per-asset multiplier converts to real shares | Corporate actions (splits, bonuses) change one number instead of rewriting every pledge |
| 2026-11-06 | Corporate actions | Supported through the per-asset share multiplier while the asset is frozen | Spec P8.4 |
| 2026-11-06 | Oracle | Prices and session calendars are signed by a 2-of-3 oracle signer set | Spec P8.6 |
| 2026-11-06 | Price source | Twelve Data first, Yahoo Finance as fallback; USD/INR from two free FX sources (median) | Team decision |
| 2026-11-06 | Calendar | The Arc deployment runs a **compressed session calendar** (short sessions, short gaps, a longer "weekend"), with time-based parameters scaled to match. The real NSE calendar is supported by the same code | Lets the full lifecycle play out in minutes |
| 2026-11-06 | Depository | Simulated CDSL ledger plus a **guided real-CDSL mode** (Easiest normal pledge with deep links and pledge-number capture) | Team decision; no broker API can create pledges |
| 2026-11-06 | Not built | zkEmail pledge proof, World ID re-check before bond withdrawal, cross-chain USDC deposit | Team decision |
| 2026-11-06 | Shortfall on re-attestation | The missing shares come out of spare first, then out of free backing, which is bond-settled into the reserve; the broker is marked Defaulted | Treats an unexplained drop as unauthorised invocation (spec A-P2-3 proposal) |
| 2026-11-06 | Insolvency | If a bond cannot cover what it owes, the uncovered tokens are written off into a per-asset `unbacked` counter shown in the app; the holder's ticket re-enters the queue for its unpaid part | Supply always equals pledged backing + reserve + unbacked; losses are visible, never hidden |
| 2026-11-06 | Reserve payouts | Reserve allocations are paid at the reference close too (claimable once it is posted), not instantly | Same reason as redemption pricing |
| 2026-11-06 | Contract admin | `Ownable2Step` on each contract, plain deployments (no proxies) | Spec defaults A-P1-1, A-P1-2 |
| 2026-11-06 | UI labels | No "mock", "demo" or "simulated" labels in the app; the README states what is simulated | Team decision |
| 2026-11-06 | Contract size | Directory addresses are cached per contract (`Wired`), the engine has no owner, optimizer runs 50 | Keeps every contract under the 24 KB limit |
| 2026-11-06 | Exchange rounding | Buy escrow rounds up, taker payouts round down, leftover escrow is refunded on close | The maker is never short |
| 2026-11-06 | Dependencies | OpenZeppelin and forge-std installed from npm (no git submodules) | Builds anywhere `pnpm install` runs, including Arc Studio |
| 2026-11-06 | API port | 8790 | 8787 is commonly taken |
| 2026-11-06 | SQLite | better-sqlite3 12.x | 13.x crashes on Node 20 |
| 2026-11-06 | Service keys | Oracle signers and keeper use mnemonic indexes 21-24; the World attestor is a separate key | No key holds two powers |
| 2026-11-06 | Worker time | Workers use chain time (never behind wall time) | Deadlines are enforced on chain time |
| 2026-11-06 | Health pokes | Only sent when health is below 1.0 or a cure clock is running | Saves gas on Arc |
| 2026-11-06 | Depository auth | Pledgee actions (confirm, invoke, release) need a signed message from the pledgee wallet | Nobody can act on someone else's account |
| 2026-11-06 | Arc scale | Deployed with `DEMO_SCALE=100`; caps are parameters and can be raised from Ops | Testnet USDC is limited |
