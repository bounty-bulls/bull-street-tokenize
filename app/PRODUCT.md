# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Four roles, each with its own workspace (confirmed):

- **Shareholders (minters):** Indian investors with shares in their own demat account. They pledge shares to a bonded broker and mint one token per share, getting liquidity without selling or moving the shares.
- **Pledge brokers:** regulated-style intermediaries who hold pledges in their CDSL account, post a USDC bond (110% of pledged value, 125% over long closures) and settle redemptions by selling on NSE.
- **Global buyers and traders:** people outside India's market hours or access routes who buy and sell tokenized Indian stocks around the clock on a peer-to-peer order book, posting their own prices.
- **Redeemers:** token holders exiting to USDC, priced at the next NSE close, with the broker's bond as the backstop.

Admins and operators run a separate operations console that isn't in the main navigation.

## Product Purpose

Bull Street turns depository pledges into on-chain stock tokens and lets people trade them peer to peer. Shares never leave the shareholder's demat account. A pledge locks them to a bonded broker, and the contracts track, per stock: tokens in existence = shares pledged behind minted tokens + bond-funded reserve + any publicly shown shortfall. Success means a buyer can trust a token is backed and redeemable, and a shareholder can earn from shares they keep, at any hour.

## Positioning

Backing is enforced by contract against pledges the broker attests to from its own CDSL account. There is no custodian holding the shares, redemptions are priced at the next NSE close so nobody profits from stale prices, and the broker's on-chain bond pays 105% if a redemption deadline is missed. Prices on the exchange come only from people's orders.

## Operating Context

- Arc testnet (chain 5042002), USDC for settlement and gas; browser wallets, Circle passkey smart accounts for traders.
- World ID gates the Minter and Broker roles: one human, one role.
- NSE is closed about 81% of the week. The order book stays open; orders expire at the next NSE open by default.
- Closing prices come from a 2-of-3 signed oracle (Twelve Data, Yahoo fallback). The Arc deployment runs a compressed session calendar.

## Capabilities and Constraints

- Pledge (connected CDSL account or guided CDSL Easiest), mint, burn, release, move backing between pledges, volunteer; broker attest, settle, release, re-attest, bond deposit/withdraw, drain, exit; limit and instant orders, cancel, reclaim; redemptions through a five-level queue with batching, cures, settlements, defaults and reserve payouts; keeper upkeep; compliance pauses, freezes, corporate actions and denylist.
- The UI must look like a real product. No "mock", "demo" or "manual" labels in the interface; the team explains the testnet setup verbally (user decision, 2026-11-06).
- The landing page lives at `/`; the app lives at `/markets`, `/trade`, `/mint`, `/broker`, `/redeem`, `/onboard` (and `/ops`, unlisted).

## Brand Commitments

- Name: Bull Street. Token symbols: `b` + NSE ticker (bRELIANCE, bTCS, bINFY); names "Bull Street <Company>". Call them pledge-backed tokens, never "wrapped".
- Visual reference supplied by the user: an institutional crypto-exchange design analysis (`../../DESIGN-coinbase.md`), to be used loosely and never copied as Coinbase branding.
- Legal footer: "Testnet. Not an offer of securities."

## Evidence on Hand

Live on-chain data (three listed stocks, brokers, pledges, orders, redemptions) via the API snapshot. There are no testimonials, customers, volumes or partner logos, and none may be invented.

## Product Principles

1. Backing is visible everywhere a token is shown.
2. Each role sees only its own job; nothing mixes broker and minter controls.
3. Numbers are exact, tabular and labelled with units (USD, ₹, shares).
4. Calm and institutional, not trading-app urgency.
