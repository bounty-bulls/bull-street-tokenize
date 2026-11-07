# Arc Studio operating manual for Bull Street

**Audience:** the Arc Studio agent, working in a workspace cloned from https://github.com/bounty-bulls/bull-street-tokenize.

**Your job:** get this existing, working project building, tested and running inside Arc Studio **exactly as it is**.

This is not a rewrite. Every rule below exists because the code already works on Arc testnet and has 54 passing contract tests and a passing end-to-end run. When a rule and your instincts disagree, follow the rule and report what you saw.

## 0. Ground rules (read twice)

1. **Do not rewrite, rename, restructure, reformat or "improve" any file.** No framework migrations: Next.js stays Next.js, Hono stays Hono. No dependency changes or version bumps. No new contracts, and no edits to existing contracts.
2. **Only change what a step below explicitly allows.** If something fails, stop, quote the exact error, and propose the smallest fix. Wait for approval before applying it.
3. **Do not deploy contracts unless a step tells you to and the user approves.** The contracts are already deployed on Arc testnet; their addresses are in `deploy/5042002/addresses.json`.
4. **Never print, commit or upload private keys.** Environment files are created by the user, not by you.
5. **Use the pinned toolchain:**
   - Node 20.
   - pnpm 10.34.5: `corepack enable`, or call `npx pnpm@10.34.5`.
   - Foundry, preferably Arc Foundry (`arc-forge`). Plain `forge` also works for build and test.
   - Solidity 0.8.28 with the cancun EVM, `via_ir = true` and `optimizer_runs = 50`, all set in `contracts/foundry.toml`. The via-IR build takes a few minutes; that is expected.

## 1. What the project is

**Bull Street** lets shareholders pledge real shares (starting with Indian NSE stocks) to bonded brokers and mint one token per pledged share at any hour. The tokens trade peer to peer, around the clock, on Arc, and every token can be redeemed for USDC at the next NSE session's close.

| Piece | Path | Stack |
|---|---|---|
| Smart contracts | `contracts/src/**` | Solidity, Foundry. 14 contracts: Directory, Params, SessionClock, PriceOracle, Compliance, RoleRegistry, AssetFactory, StockToken, BondVault, BrokerRegistry, LevelBook, PledgeRegistry, RedemptionEngine, BullStreetExchange |
| Contract tests | `contracts/test/**` | 54 Foundry tests: unit, scenario and invariant |
| Shared library | `services/shared` | TypeScript: ABIs, enums, EIP-712 types, calendar, SQLite schema |
| API | `services/api` | Hono on Node, port 8790. Serves World ID verification, the simulated CDSL depository, planners and a contract snapshot |
| Workers | `services/workers` | Oracle (prices and sessions), indexer, broker agents, keeper |
| Web app | `app` | Next.js 16, React 19, Tailwind 4, wagmi 2, IDKit 4 (World ID), Circle Modular Wallets (passkeys) |
| Deployment | `deploy/5042002/addresses.json` | Live Arc testnet addresses (chain 5042002) |

It is a **pnpm workspace** (`pnpm-workspace.yaml`): `app`, `contracts`, `services/*`. The app depends on `@bullstreet/shared` from the workspace, so always install from the repository root.

## 2. Arc facts the code already handles (do not "fix" these)

- **USDC is gas.** The ERC-20 interface is `0x3600000000000000000000000000000000000000` with 6 decimals. Contracts only use the ERC-20 interface, never `msg.value`.
- **20 gwei fee floor.** The mempool rejects `maxFeePerGas` below 20 gwei. viem's estimates on Arc are above it; leave fee handling alone.
- **RPC:** `https://rpc.testnet.arc.network`. `https://rpc.testnet.arc.io` is the same network. The app accepts a comma-separated list and fails over.
- **Explorer:** `https://testnet.arcscan.app`, which redirects to `explorer.testnet.arc.io`.

## 3. Step A: install and test the contracts (Smart Contract mode)

From the repository root:

```
corepack enable && pnpm install --frozen-lockfile
cd contracts && forge build && forge test
```

**Expected:** `54 tests passed, 0 failed`.

- `pnpm install` puts OpenZeppelin 5.6.1 and forge-std in `contracts/node_modules`, and `remappings.txt` points there. There are no git submodules.
- If `pnpm install` cannot build `better-sqlite3` (a native module the services use), run `pnpm install --frozen-lockfile --filter @bullstreet/contracts --filter @bullstreet/app...` instead. Report it either way.
- **Do not change** `foundry.toml`, `remappings.txt`, the contracts or the tests.

**Show the user:**
- the test summary;
- the deployed addresses in `deploy/5042002/addresses.json`, linked to `https://testnet.arcscan.app/address/<address>`.

## 4. Step B: run the web app in the live preview (Build mode)

The live backend (API and workers) runs on the team's machine and is reachable at a public HTTPS URL the user gives you (for example `https://<something>.trycloudflare.com`). The preview talks to it from the browser, so the sandbox's network allowlist does not matter for it.

1. Create `app/.env.local` with exactly these keys. The user supplies the values; all of them are public client values, and there are no secrets in this file.

   ```
   NEXT_PUBLIC_CHAIN_ID=5042002
   NEXT_PUBLIC_RPC_URL=https://rpc.testnet.arc.network,https://rpc.testnet.arc.io
   NEXT_PUBLIC_API_URL=<public URL of the Bull Street API from the user>
   NEXT_PUBLIC_WORLD_APP_ID=<from the user>
   NEXT_PUBLIC_WORLD_RP_ID=<from the user>
   NEXT_PUBLIC_WORLD_ENV=staging
   NEXT_PUBLIC_WORLD_ACTION=bullstreet-role-v1
   NEXT_PUBLIC_CIRCLE_CLIENT_KEY=<from the user>
   NEXT_PUBLIC_CIRCLE_CLIENT_URL=<from the user>
   ```

2. Start the app: `cd app && CHAIN_ID=5042002 npx next dev --port <preview port> -H 0.0.0.0`.
   - Use whichever port the Arc Studio preview expects.
   - **Do not convert the app to Vite or any other framework.** If the preview cannot attach to a Next.js dev server, try `cd app && CHAIN_ID=5042002 npx next build && npx next start --port <port> -H 0.0.0.0`.
   - If that also fails, stop and report. Do not migrate.
3. Open the preview. The app's pages are `/` (landing), `/markets`, `/trade`, `/mint`, `/broker`, `/redeem`, `/ops` and `/onboard`.

**Verify:**
- `/markets` lists bRELIANCE, bTCS and bINFY with an NSE close price and live brokers.
- `/trade` shows an order book.
- The header shows the NSE session status.

## 5. Step C (optional, only if the user asks): run the API and workers in the sandbox

Only do this if the user wants the backend inside Arc Studio as well.

- The sandbox network allowlist **blocks** the price sources (Yahoo Finance, Twelve Data) and the World ID verify API. Inside the sandbox, the oracle cannot fetch prices and real World ID verification fails.
- **Never run the workers in the sandbox while the team's machine runs them too.** Both use the same keys, so transactions would be sent twice.

If asked:
1. The user creates `.env` at the root from `.env.example` and fills the values themselves.
2. Run `pnpm api` in one terminal.
3. Run `pnpm --filter @bullstreet/workers start -- --only=indexer,keeper` in another. Leave the oracle and broker agents on the team's machine.

## 6. Step D (optional, only if the user explicitly asks): fresh deployment

The deploy script is `scripts/deploy.ts arc`, a wrapper around `contracts/script/Deploy.s.sol` that always passes `--slow`. It needs these environment variables:

`DEPLOYER_PRIVATE_KEY`, `USDC_ADDRESS=0x3600000000000000000000000000000000000000`, `WORLD_ATTESTOR_ADDRESS`, `ORACLE_SIGNERS`, `ORACLE_THRESHOLD=2`, `TREASURY`, `CALENDAR_MODE=compressed`, `DEMO_SCALE=100`.

- The script writes `deploy/5042002/addresses.json`.
- Seeding (`pnpm seed`) needs about 350 test USDC.
- **Do not do this by default.** The current deployment is live and seeded.

## 7. What "done" looks like (report this back)

- [ ] `forge test`: 54 passed (paste the summary).
- [ ] The preview shows `/markets` with the three stocks and brokers, read from Arc testnet.
- [ ] A wallet connects in the preview. The user can trade on `/trade` with test USDC from the built-in faucet.
- [ ] No source files changed apart from `app/.env.local`. Show `git status`.
- [ ] A short summary listing the commands you ran and anything that failed, with exact errors.
