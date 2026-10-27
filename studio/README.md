# Delivered

Agents pay for API calls only when the result arrives. Delivered is a USDC escrow protocol on Arc that releases payment only after an independent evaluator confirms a valid delivery receipt.

Built with [Arc Studio](https://studio.arc.io)

## How it works

1. **Buy** — the buyer approves USDC, calls `createAndFundJob`, and funds the escrow.
2. **Deliver** — the buyer posts to the gateway (`POST /deliver`). The provider runs the check, signs a receipt, and returns the result.
3. **Submit** — the buyer submits the signed receipt on-chain (`submitWithSignature`).
4. **Evaluate** — the evaluator agent verifies the receipt and calls `complete` (payment released) or `reject` (refund sent).

If the provider admits failure (receipt status = 1) the buyer can claim a refund immediately. If the job expires without a submission, anyone can trigger the refund.

## Stack

- Smart contract: Solidity, Foundry, Arc Testnet (USDC as gas)
- Web app: React, Vite, TypeScript, wagmi, ConnectKit, viem, Tailwind CSS
- Evaluator: Cloudflare Worker (cron) + Node script
- Scripts: TypeScript, viem, `npx tsx`

## Deployed contracts

| Network     | Address |
|-------------|---------|
| Arc Testnet | `0x72d179ba5fedf0e6f24c0030afe66d21b5de9904` |
| Arc Mainnet | TBD |

## Environment variables

| Variable | Purpose |
|----------|---------|
| `PROVIDER_KEY` | Private key of the provider wallet (setup script only) |
| `PAYOUT_ADDRESS` | Where USDC goes on job completion; defaults to the provider address (optional) |
| `EVALUATOR_KEY` | Private key of the evaluator wallet (evaluator and e2e scripts only) |
| `PROVIDER_ADDR` | Provider's registered address — printed by setup-provider.ts (e2e script) |
| `NETWORK` | `testnet` (default) or `mainnet` (all scripts) |
| `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN` | Arc Studio RPC proxy — optional, auto-detected from env |

Never put private keys in source files. Put them in environment variables or a local `.env` file that is listed in `.gitignore`.

## Running the app

```
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Provider setup (one time)

Fund the provider wallet with testnet USDC, then run:

```
PROVIDER_KEY=0x… npx tsx scripts/setup-provider.ts
```

Copy the printed `PROVIDER_ADDRESS` and `PROVIDER_AGENT_ID` into `src/lib/delivered-config.ts`.

## Evaluator

**Deploy to Cloudflare Workers:**

```
cd evaluator
wrangler kv:namespace create EVALUATIONS          # copy the id into wrangler.toml
wrangler secret put EVALUATOR_KEY                 # paste the private key
wrangler deploy
```

The Worker runs every minute. After deploy, copy the Worker URL into `EVALUATOR_URL` in `src/lib/delivered-config.ts`.

**Run locally (one pass):**

```
EVALUATOR_KEY=0x… npx tsx evaluator/run-once.ts
```

## End-to-end test

Do not run this automatically. Read `scripts/e2e.ts` first. Requires funded wallets.

```
BUYER_KEY=0x… EVALUATOR_KEY=0x… PROVIDER_ADDR=0x… npx tsx scripts/e2e.ts
```

## Tests

```
forge test
```

## Build

```
bun run build
```
