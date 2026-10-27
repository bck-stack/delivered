# Delivered

Pay-on-delivery USDC escrow for AI agents buying API calls on Arc Testnet. A client agent funds a job; the provider delivers via a signed receipt; an independent evaluator releases or refunds the escrow. Provider reputation is written to the ERC-8004 registry on every outcome.

Built with [Arc Studio](https://studio.arc.io). Built for Arc Microgrants.

## Tech Stack

- Solidity 0.8.28 + Foundry
- OpenZeppelin 5.6.1 (ReentrancyGuard, SafeERC20, EIP712, ECDSA)
- ERC-8183 job semantics (standalone implementation)
- ERC-8004 reputation registry (canonical Arc Testnet deployment)
- Chain: Arc Testnet (Chain ID 5042002)
- Payment token: USDC at `0x3600000000000000000000000000000000000000` (6 decimals)

## Contracts

| Contract | Address (Arc Testnet) |
|---|---|
| Delivered | `0xb33dbe7b6016c88e1455a49cf840709440a93728` |

## Development

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- [Bun](https://bun.sh)

### Install

```bash
bun install
```

### Build contracts

```bash
bun run contracts:build
# or: forge build
```

### Run tests

```bash
bun run contracts:test
# or: forge test -v
```

### Environment Variables

None required for contract build and test. The contract hardcodes USDC and the ERC-8004 reputation registry address for Arc Testnet.

| Variable | Purpose |
|---|---|
| `RPC_PROXY_BASE_URL` | RPC proxy base URL — optional outside Arc Studio |
| `RPC_PROXY_TOKEN` | RPC proxy auth token — optional outside Arc Studio |
| `RPC_PROXY_CHAINS` | Comma-separated chain keys — optional outside Arc Studio |

## Contract Overview

### Roles

- **client** — AI agent wallet that buys one API call. Creates and funds the job.
- **provider** — API seller. Registers a `deliverySigner` address that signs delivery receipts off-chain. Must call `registerProvider(agentId, payoutAddress)` and `setDeliverySigner(signerAddr)` before accepting jobs.
- **evaluator** — Independent checker named in the job. Sole authority to complete (pay provider) or reject (refund client).

### Job Lifecycle

1. `createAndFundJob(provider, evaluator, expiry, requestHash, amount)` — client approves USDC then calls this; both job creation and funding happen atomically.
2. Provider's delivery signer signs an EIP-712 `DeliveryReceipt{jobId, requestHash, responseHash, status, deliveredAt}`. Anyone calls `submitWithSignature(...)` to record it on-chain.
3. Evaluator calls `complete(jobId, reasonHash)` to pay the provider, or `reject(jobId, reasonHash)` to refund the client.

### Automatic Refund Paths

- `deliveryStatus = 1` (admitted failure): client calls `claimRefund` immediately.
- Job expired without submission: client calls `claimRefund` after `expiry`.
- Evaluator timeout: client calls `claimRefund` 24 hours after submission if evaluator hasn't acted.

### Provider Score

```solidity
getProviderStats(address provider) returns (ProviderStats memory stats, uint8 score)
```

`score = completed * 100 / (completed + rejected + expired)`. Zero-jobs default: 50. Admitted failures tracked separately and excluded from denominator.

### ERC-8004 Reputation Feedback

| Outcome | value | tag2 |
|---|---|---|
| Completed | +10 | "completed" |
| Rejected | -10 | "rejected" |
| Expired | -5 | "expired" |
| Admitted failure | -2 | "failed-admitted" |

Reputation writes are wrapped in `try/catch` — a provider without a registered ERC-8004 agentId simply skips the write.
