/**
 * App-side onchain config — mirrors scripts/config.ts for the active network.
 * To switch to mainnet: change CHAIN_ID, CHAIN, and DELIVERED_ADDRESS to the
 * mainnet values (one place to edit).
 */
import { arc } from 'viem/chains'
import { requireChain, getUsdc, buildTxExplorerUrl, buildAddressExplorerUrl } from '@/onchain-facts'

// ── Chain ──────────────────────────────────────────────────────────────────
export const CHAIN    = arc
export const CHAIN_ID = arc.id // 5042 Arc

export const chain = requireChain(CHAIN_ID)
export const usdc  = getUsdc(CHAIN_ID)!

// ── Contract ───────────────────────────────────────────────────────────────
// Deployed 2026-10-27 — constructor arg = reputation registry below
// (Arc Testnet deployment: 0x72d179ba5fedf0e6f24c0030afe66d21b5de9904)
export const DELIVERED_ADDRESS = '0x6f721eb4f16a972e9d77e4a57fd5324e513476a9' as `0x${string}`
export const DEPLOY_BLOCK = 28151462n

// ── ERC-8004 registries (Arc) ─────────────────────────────────────────────
export const IDENTITY_REGISTRY   = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as `0x${string}`
export const REPUTATION_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63' as `0x${string}`

// ── Provider ───────────────────────────────────────────────────────────────
// Filled after running scripts/setup-provider.ts
export const PROVIDER_ADDRESS  = '0xC0cdb5D59CfB277d572A97672AA35910ecDC8c10' as `0x${string}`
export const PROVIDER_AGENT_ID = 2789n

// ── Evaluator ──────────────────────────────────────────────────────────────
// Default address shown in the "Buy a check" form (user can override).
// Filled after deploying the evaluator Worker.
export const DEFAULT_EVALUATOR = '0x53196F6B1aDA1ab5892e2e71915AE1417190139F' as `0x${string}`

// URL of the deployed evaluator Worker — used by Ledger to show reasons.
// Leave empty until deployed.
export const EVALUATOR_URL = 'https://delivered-evaluator.chainmarket-api.workers.dev'

// ── Gateway ────────────────────────────────────────────────────────────────
export const GATEWAY_URL = 'https://delivered.chainmarket-api.workers.dev'

// ── Job settings ───────────────────────────────────────────────────────────
export const JOB_EXPIRY_SECONDS = 30 * 60 // 30 minutes

// ── Explorer helpers ───────────────────────────────────────────────────────
export { buildTxExplorerUrl, buildAddressExplorerUrl }
