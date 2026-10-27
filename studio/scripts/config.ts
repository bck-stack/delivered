/**
 * Shared onchain configuration for scripts and evaluator.
 * Network is selected by the NETWORK env variable: "testnet" (default) | "mainnet".
 *
 * The app reads its own copy from src/lib/delivered-config.ts, which mirrors
 * the values here. Keep them in sync when deploying to mainnet.
 */

export type Network = 'testnet' | 'mainnet'

export function getNetwork(): Network {
  const n = (process.env.NETWORK ?? 'testnet').toLowerCase()
  if (n !== 'testnet' && n !== 'mainnet') {
    throw new Error(`NETWORK must be "testnet" or "mainnet", got "${n}"`)
  }
  return n
}

// ── Per-network facts ──────────────────────────────────────────────────────

interface NetworkConfig {
  name: string
  chainId: number
  rpcUrl: string
  explorerBase: string
  usdcAddress: `0x${string}`
  deliveredAddress: `0x${string}`
  identityRegistry: `0x${string}`
  reputationRegistry: `0x${string}`
  deliverySigner: `0x${string}`
  gateway: string
}

const TESTNET: NetworkConfig = {
  name: 'Arc Testnet',
  chainId: 5042002,
  rpcUrl: process.env.RPC_PROXY_BASE_URL
    ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc_Testnet?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
    : 'https://rpc.testnet.arc.io',
  explorerBase: 'https://explorer.testnet.arc.io',
  usdcAddress: '0x3600000000000000000000000000000000000000',
  // Deployed 2026-10-27; constructor arg = reputation registry below
  deliveredAddress: '0x72d179ba5fedf0e6f24c0030afe66d21b5de9904',
  identityRegistry:  '0x8004A818BFB912233c491871b3d84c89A494BD9e',
  reputationRegistry:'0x8004B663056A597Dffe9eCcC1965A193B7388713',
  deliverySigner:    '0xd4BF2B7639D11e8d84968Fe4fEE5f1eBFAAdeDe2',
  gateway: 'https://delivered.chainmarket-api.workers.dev',
}

// Mainnet values — fill in after mainnet deploy
const MAINNET: NetworkConfig = {
  name: 'Arc',
  chainId: 5042,
  rpcUrl: 'https://rpc.mainnet.arc.io',
  explorerBase: 'https://explorer.arc.io',
  usdcAddress: '0x3600000000000000000000000000000000000000',
  deliveredAddress: '0x0000000000000000000000000000000000000000', // TODO: fill after mainnet deploy
  identityRegistry:  '0x0000000000000000000000000000000000000000', // TODO: verify mainnet registry
  reputationRegistry:'0x0000000000000000000000000000000000000000', // TODO: verify mainnet registry
  deliverySigner:    '0xd4BF2B7639D11e8d84968Fe4fEE5f1eBFAAdeDe2',
  gateway: 'https://delivered.chainmarket-api.workers.dev',
}

export function getConfig(network?: Network): NetworkConfig {
  const net = network ?? getNetwork()
  return net === 'mainnet' ? MAINNET : TESTNET
}

export function explorerTx(cfg: NetworkConfig, hash: string): string {
  return `${cfg.explorerBase}/tx/${hash}`
}

export function explorerAddr(cfg: NetworkConfig, addr: string): string {
  return `${cfg.explorerBase}/address/${addr}`
}
