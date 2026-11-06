# Bull Street: product and research context

> The single source of context for Bull Street. Read it before changing the design.
> **Updated:** 2026-11-06. **Companion files:** [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) (specification as built), [decisions.md](decisions.md).
> Facts carry a source; unverified items are marked **[unverified]**.

---

## 1. Status

| Item | Value |
|---|---|
| Product | **Bull Street**: pledge-backed tokens for NSE stocks, traded peer to peer, redeemed for USDC through bonded brokers |
| Chain | **Arc testnet** (5042002), USDC settlement and gas |
| Identity | **World ID** Proof of Human (IDKit 4) |
| Trading | **Peer-to-peer order book** (`BullStreetExchange`); no AMM, no pool, no Uniswap integration |
| Tokens | `bRELIANCE`, `bTCS`, `bINFY` ("Bull Street Reliance Industries", ...) |
| Calendar on Arc | Compressed sessions (10 min open, 20 min gaps, 80 min "weekend"); the same contracts run the real NSE calendar |
| Prices | Twelve Data first, Yahoo Finance fallback; USD/INR median of Frankfurter, open.er-api and Yahoo |
| Depository | Simulated CDSL ledger plus a guided real-CDSL (Easiest) mode |
| Code | `contracts/` (14 contracts, 54 tests), `services/` (api, workers, shared), `app/` (Next.js), all built |

---

## 2. Arc and World requirements we design for

**Arc** ("Best DeFi / Onchain Finance App Built End to End in Arc Studio"): a DeFi or on-chain finance app on Arc using USDC or EURC for settlement; trading apps including tokenized real-world assets are in scope. Arc facts: chain 5042002, RPC `https://rpc.testnet.arc.network`, explorer `https://testnet.arcscan.app`, USDC is the native gas token and its ERC-20 interface is `0x3600…0000` with 6 decimals (natively 18). Circle Modular Wallets (passkey smart accounts) support Arc testnet (the SDK ships an `ArcTestnet_USDC` constant).

**World** ("Best Use of IDKit"): use the credential proportionate to the trust moment, verify on the server or on-chain, show a success path and a meaningful alternative path, and write a short integration debrief. IDKit 4 requires the backend to sign an `rp_context` ([migration guide](https://docs.world.org/world-id/4-0-migration.md)).

---

## 3. The problem

### 3.1 The issuer model
1. An authorised participant (AP) buys the real share; a custodian holds it; the issuer mints a token; the AP sells it.
2. Redemption is the reverse, and AP arbitrage keeps the token near the share price.
3. **Every mint needs a share bought at that moment**, so minting only happens while a market is open.

Robinhood Stock Tokens are "tokenised debt securities issued by Robinhood Assets (Jersey) Limited"; minting and burning run "Monday 02:00 – Saturday 02:00 CET… Outside this window, minting and burning is not supported" ([docs](https://docs.robinhood.com/chain/stock-tokens/)).

### 3.2 Evidence: the HIMS squeeze, 30-31 August 2026
About 15,227 HIMS tokens existed, ~13,100 of them in one memecoin pool. On Sunday night the token hit **$61.15 against a Friday close of $28.84 (+112%)** while the mint window was shut. When minting reopened the issuer minted 18,750 tokens in 294 mints and the premium fell from 93% to 12% in twelve minutes ([DeFi Prime](https://defiprime.com/tokenized-stock-float-squeeze), [The Defiant](https://thedefiant.io/news/tokens/a-memecoin-called-boner-has-cornered-half-the-tokenized-hims-and-hers-float)).

### 3.3 Problems we address
| # | Problem | Bull Street |
|---|---|---|
| P1 | Supply freezes when the market is closed | Pledge on business days; **mint against existing pledges at any hour** |
| P2 | One gatekeeper adds supply and keeps the gain | Any verified owner can mint, so many minters compete |
| P3 | Holders own an issuer's promise | Shares stay with their owners; a bonded broker guarantees payouts |
| P4 | The same stock is split across issuers | One token per stock |
| P5 | NSE is closed ~81% of the week; foreign access is hard | India-sourced, globally held, traded around the clock |

**Limits we state openly:** premiums are capped only while spare pledged shares exist; redemption waits for the next session and T+1; the token is a claim that pays out in USDC, not a share; trust is spread out, not removed; regulation is out of scope for the prototype.

---

## 4. Pledges in India (CDSL/NSDL)

Main source: CDSL DP Operating Instructions as of 2025-03-31 ([PDF](https://www.cdslindia.com/downloads/DP/currentDPs/DP-Operating-Instructions-Chapter-as-on-March-31-2025.pdf)).

| Fact | Source |
|---|---|
| Any CDSL account holder can be pledgee for a normal pledge; both sides at CDSL | OI 8.1, 8.5.1 |
| Part or full invocation by the pledgee without any action by the pledgor | OI 8.2, 8.5.5 |
| Unpledge can be full or part, from either side | OI 8.5.3-8.5.4 |
| A pledgee can auto-accept pledges with a standing instruction | OI 8.5.1-8.5.2 |
| Unaccepted requests auto-reject after 15 days | OI 8.5.6 |
| Beneficial interest (dividends) stays with the pledgor | OI 8.2 |
| Easiest "Normal Pledge": Pledge → Pledgor → Pledge Setup → pledgee BO ID (trusted account) → ISIN, quantity, dates, agreement no. → commit with PIN; same day if before 4 PM | [Zerodha support](https://support.zerodha.com/category/your-zerodha-account/transfer-of-shares-and-conversion-of-shares/cdsl-easi-easiest/articles/pledge-using-cdsl-easiest) |
| SEBI 2026 framework: the pledgee gives the pledgor reasonable notice before selling; the pledgor can redeem until the sale | [Kotak Neo circular](https://www.kotakneo.com/uploads/2026_0041_Policy_Operating_guidelines_in_terms_of_260323_083303_649071b84b.pdf) |

**Routes considered:** broker margin pledges always go to the broker itself (rejected); a third-party pledge form is slow (fallback); **CDSL Easiest normal pledge with pledgee auto-accept (chosen)**; CDSL LAS / NSDL Digital LAS with OTP and API callbacks is the production path for banks and NBFCs. No broker API (Kite, Upstox, Dhan, Fyers, Angel, Groww) and no Account Aggregator schema can create or report a normal pledge.

**Proof of pledge:** the broker, as pledgee, sees the pledge in its own account and signs an EIP-712 attestation; lying is slashable through its bond. Attestations are renewed regularly.

---

## 5. Economic model (as built)

### 5.1 Pledge ledger
Per pledge, in token units (a per-asset multiplier converts to real shares):

| Symbol | Meaning |
|---|---|
| q | pledged and not invoked |
| m | tokens outstanding backed by this pledge |
| a | part of m assigned to open redemption allocations |
| f = m − a | free backing |
| s = q − m | spare (mintable or releasable) |

Invariant `0 ≤ a ≤ m ≤ q`. History: invoked, cured, released, bond-settled.

### 5.2 Brokers
| Tier | Single-pledge cap | Minimum bond |
|---|---|---|
| T1 | 2,000 USDC | 2,200 |
| T2 | 20,000 | 22,000 |
| T3 | 200,000 | 220,000 |

Caps and bonds are divided by `DEMO_SCALE` on testnet. Exposure is the value of all pledged shares; capacity is bond / 1.10 (1.25 over long closures); health is bond / (ratio × exposure). Below 1.2 pledges turn at-risk; below 1.0 for HEALTH_CURE the broker drains. States: Pending → Active → Draining → Exited, or Defaulted. Holdings larger than a tier cap are split across brokers by the off-chain planner (least-utilised first, at most half a large holding per broker).

### 5.3 Redemption queue
Levels, each used only when every higher level is empty: **L0 reserve, L1 draining/defaulted brokers, L2 volunteers, L3 at-risk, L4 normal.** Within a level: best fit (smallest free backing that covers the need, else the largest), preferring brokers not yet used by the ticket, then the minter invoked longest ago, then the lowest pledge id. At most `MAX_ALLOCS` allocations per transaction; leftovers continue permissionlessly. Requests below `SMALL_MAX` shares are batched per session and paid pro rata.

### 5.4 Payouts: priced at the next session
Every path is priced at the close of `refSession`, the first session that opens after the request:

| Path | Holder receives |
|---|---|
| Reserve | refClose × x × (1 − 0.20%) |
| Cure (minter, before refSession open + CURE_GRACE) | refClose × x × (1 − 0.20%); the minter escrows 120% of the last close and is refunded the rest |
| Settle (broker, after the cure deadline) | max(sale, 0.99 × refClose) × x × (1 − 0.20%), plus late fees from the bond after the soft deadline |
| Default (after the hard deadline, or once the reference close is posted if the broker already defaulted) | close of the hard session × x × 1.05 + late fees, from the bond; only the covered part burns, the rest goes back into the queue |

**Why the next session:** pricing at the last close would let anyone buy cheaply after weekend news and redeem at Friday's price, leaving brokers to pay the gap; minters would cure only when prices rose. With next-session pricing a broker settling at the session's price loses nothing (tested: a 10% weekend crash).

### 5.5 Fees
Mint 0.10% and redeem 0.20%, half to the pledge's broker and half to the treasury; volunteers get a 0.05% rebate from the treasury's half; taker fee 0.10% on the order book.

### 5.6 Failure handling
- **Stale pledge** (no re-attestation for STALE_GRACE after expiry): its free backing moves to the reserve, paid from the bond at close × 1.05; the broker drains.
- **Shortfall on re-attestation** (fewer shares than q − a): missing shares come out of spare first, then free backing is bond-settled into the reserve; the broker defaults.
- **Insolvent broker** (defaulted with an empty bond): its pledges' free backing is written off as unbacked so the queue stops routing to it.
- **Release** (minter unpledges spare shares): the broker unpledges and confirms within two sessions or pays a 0.5% penalty from its bond.
- **Migration:** make-before-break moves minted backing to another attested pledge.

---

## 6. Trading: a peer-to-peer order book
Makers post limit orders and escrow what they offer; takers fill them at the maker's price, in one transaction. No pool, no market maker, no oracle in pricing. Orders expire at the next NSE open by default so that resting prices cannot be picked off after news; anyone can return an expired order's escrow. Rounding always favours the maker. Pausing an asset stops trading but never cancelling.

---

## 7. Identity: one human, one role
Proof of Human is the minimum assurance that keeps a pledge's minter and broker independent; holders are not gated. The action `bullstreet-role-v1` serves both roles, so one nullifier maps to one role, enforced in the API and on-chain.

---

## 8. Open risks
Collusion between two people; gap risk above the bond buffer; oracle trust; INR-USDC rail; regulation (SCRA, FEMA, VDA tax); dividend and corporate-action handling; NSDL not supported; pledge existence between attestations; liquidity bootstrap (see the README roadmap).

---

## 9. Glossary
| Term | Meaning |
|---|---|
| Demat | Electronic share account |
| CDSL / NSDL | India's two depositories |
| BO ID | 16-digit CDSL account number |
| PSN | Pledge sequence number |
| Pledgor / pledgee | Owner / the party pledged to |
| Invoke | Pledgee takes pledged shares (CDSL: "confiscate") |
| Easiest | CDSL's investor web portal |
| Session | One NSE trading day (or one compressed session) |
| Cure | The minter pays the holder and keeps the shares |
| Drain | A broker winding down; its pledges are served first |
