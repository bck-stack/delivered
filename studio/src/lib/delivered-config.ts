/**
 * App-side onchain config — mirrors scripts/config.ts for the active network.
 * To switch to mainnet: change CHAIN_ID, CHAIN, and DELIVERED_ADDRESS to the
 * mainnet values (one place to edit).
 */
import { arcTestnet } from 'viem/chains'
import { requireChain, getUsdc, buildTxExplorerUrl, buildAddressExplorerUrl } from '@/onchain-facts'

// ── Chain ──────────────────────────────────────────────────────────────────
export const CHAIN    = arcTestnet
export const CHAIN_ID = arcTestnet.id // 5042002 Arc Testnet

export const chain = requireChain(CHAIN_ID)
export const usdc  = getUsdc(CHAIN_ID)!

// ── Contract ───────────────────────────────────────────────────────────────
// Deployed 2026-10-27 — constructor arg = reputation registry below
export const DELIVERED_ADDRESS = '0x72d179ba5fedf0e6f24c0030afe66d21b5de9904' as `0x${string}`

// ── ERC-8004 registries (Arc Testnet) ─────────────────────────────────────
export const IDENTITY_REGISTRY   = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as `0x${string}`
export const REPUTATION_REGISTRY = '0x8004B663056A597Dffe9eCcC1965A193B7388713' as `0x${string}`

// ── Provider ───────────────────────────────────────────────────────────────
// Filled after running scripts/setup-provider.ts
export const PROVIDER_ADDRESS  = '' as `0x${string}` // e.g. '0x...'
export const PROVIDER_AGENT_ID = 0n                  // e.g. 5n

// ── Evaluator ──────────────────────────────────────────────────────────────
// Default address shown in the "Buy a check" form (user can override).
// Filled after deploying the evaluator Worker.
export const DEFAULT_EVALUATOR = '' as `0x${string}`

// URL of the deployed evaluator Worker — used by Ledger to show reasons.
// Leave empty until deployed.
export const EVALUATOR_URL = ''

// ── Gateway ────────────────────────────────────────────────────────────────
export const GATEWAY_URL = 'https://delivered.chainmarket-api.workers.dev'

// ── Job settings ───────────────────────────────────────────────────────────
export const JOB_EXPIRY_SECONDS = 30 * 60 // 30 minutes

// ── Explorer helpers ───────────────────────────────────────────────────────
export { buildTxExplorerUrl, buildAddressExplorerUrl }
