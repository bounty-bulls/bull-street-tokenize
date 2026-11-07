# Arc Studio: step-by-step prompts

Paste these into Arc Studio one turn at a time, waiting for each turn to finish. Each prompt is under Arc Studio's 10,000-character limit.

The full rules the agent must follow are in [`GUIDE.md`](GUIDE.md). Every prompt tells it to read that file first.

## Before you start (on your laptop, about 5 minutes)

1. Keep the Bull Street API and workers running on your laptop against Arc testnet (`pnpm api`, `pnpm workers`). This is the live backend.
2. Expose the API over HTTPS so the Arc Studio preview can reach it:
   ```
   brew install cloudflared
   cloudflared tunnel --url http://localhost:8790
   ```
   Copy the `https://….trycloudflare.com` URL it prints. Keep the terminal open.
   Check it: open `<that URL>/deployment` in a browser. It should show the contract addresses.
3. Have these values ready from your `app/.env.local`: the World app ID, World RP ID, Circle client key and Circle client URL.
4. Optional, for passkeys in the preview: in Circle Console, add the Arc Studio preview domain to the Modular Wallets client key's allowed domains.

Open https://studio.arc.io, sign in with your Circle account, and choose **From GitHub**.

## Turn 1: import (Build mode)

```text
Clone this public GitHub repo into my workspace: https://github.com/bounty-bulls/bull-street-tokenize

It is an existing, working project (Bull Street: pledge-backed stock tokens on Arc testnet, already deployed). Your job is to get it running here exactly as it is, not to rebuild it.

Before doing anything else, read docs/arc-studio/GUIDE.md in the repo completely and follow it as your operating rules. In short:
- Do not rewrite, restructure, rename, reformat, migrate or upgrade anything. Next.js stays Next.js. No new contracts, no contract edits, no dependency changes.
- Do not deploy anything. The contracts are already live on Arc testnet (deploy/5042002/addresses.json).
- If something fails, stop, quote the exact error, and propose the smallest fix. Wait for my approval before changing any file.

For this turn only: clone the repo, read GUIDE.md, and reply with (1) a short summary of the repo layout as you understand it, and (2) the exact commands you plan to run for Step A and Step B of the guide. Do not run them yet.
```

## Turn 2: contracts (Smart Contract mode)

```text
Run Step A of docs/arc-studio/GUIDE.md now: from the repo root run `corepack enable && pnpm install --frozen-lockfile`, then `cd contracts && forge build && forge test`.

Rules: do not edit foundry.toml, remappings.txt, any contract or any test. Do not deploy. The via-IR build takes a few minutes; that is expected.

Expected result: 54 tests passed, 0 failed.

Report: the forge test summary line, the list of test suites with pass counts, and a table of the deployed contract addresses from deploy/5042002/addresses.json with links of the form https://testnet.arcscan.app/address/<address>. If pnpm install fails on better-sqlite3, use the fallback install command from the guide and tell me.
```

## Turn 3: run the app in the live preview (Build mode)

Replace the `<…>` values before pasting.

```text
Run Step B of docs/arc-studio/GUIDE.md.

1. Create app/.env.local with exactly these lines (no other changes anywhere):
NEXT_PUBLIC_CHAIN_ID=5042002
NEXT_PUBLIC_RPC_URL=https://rpc.testnet.arc.network,https://rpc.testnet.arc.io
NEXT_PUBLIC_API_URL=<your cloudflared https URL>
NEXT_PUBLIC_WORLD_APP_ID=<your World app id>
NEXT_PUBLIC_WORLD_RP_ID=<your World rp id>
NEXT_PUBLIC_WORLD_ENV=staging
NEXT_PUBLIC_WORLD_ACTION=bullstreet-role-v1
NEXT_PUBLIC_CIRCLE_CLIENT_KEY=<your Circle client key>
NEXT_PUBLIC_CIRCLE_CLIENT_URL=<your Circle client URL>

2. Start the Next.js app for the live preview: `cd app && CHAIN_ID=5042002 npx next dev --port <the preview port> -H 0.0.0.0`. Do not convert it to Vite or change any config. If the preview cannot attach to the dev server, try `npx next build && npx next start --port <port> -H 0.0.0.0` in app/. If that also fails, stop and show me the exact error.

3. Open /markets in the preview and confirm it lists bRELIANCE, bTCS and bINFY with an NSE close and live brokers, and that /trade shows an order book.

Report what you ran, what the preview shows, and `git status` (only app/.env.local should be new).
```

## Turn 4: check the main flows (Build mode)

```text
Using the live preview, without changing code:
1. Connect a wallet, get test USDC from the built-in faucet, and confirm the header shows the connected account.
2. On /trade, buy 1 bRELIANCE from the best ask. Report the transaction hash and its link on https://testnet.arcscan.app.
3. Open /markets and /redeem and confirm they load without errors.
List any console errors with their exact text. Do not fix anything in this turn; just report.
```

## Turn 5 (optional): architecture summary for judges (Plan mode)

```text
Read docs/architecture.md, docs/CONTEXT.md and contracts/src. Write (do not change code) a one-page summary of the architecture for judges: components, the pledge → mint → trade → redeem flow, how World ID and Circle tools are used, and which parts run on Arc. Keep the mermaid diagram from docs/architecture.md.
```

## If something goes wrong

| Problem | What to tell Arc Studio |
|---|---|
| It starts changing files on its own | "Stop. Revert every change except app/.env.local (git checkout -- . ), then re-read docs/arc-studio/GUIDE.md section 0." |
| The preview shows "Failed to fetch" | The cloudflared tunnel is down or the URL changed. Restart it, update `NEXT_PUBLIC_API_URL`, restart the dev server. |
| Prices look stale | The workers on your laptop are stopped. Start `pnpm workers` there, never in the sandbox. |
| The sandbox paused | Send any message; it resumes in 5–15 s. Then restart the dev server. |
| You hit a usage limit | Studio has daily caps (see docs.arc.io/ai/arc-studio-troubleshooting.md). Keep turns focused; don't ask it to explore. |
