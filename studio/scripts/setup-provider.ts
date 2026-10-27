/**
 * One-time provider setup script.
 *
 * Run:
 *   PROVIDER_KEY=0x… npx tsx scripts/setup-provider.ts
 *   PROVIDER_KEY=0x… PAYOUT_ADDRESS=0x… npx tsx scripts/setup-provider.ts
 *   PROVIDER_KEY=0x… NETWORK=mainnet npx tsx scripts/setup-provider.ts
 *
 * What it does:
 *   1. Registers an ERC-8004 identity on the canonical identity registry.
 *   2. Reads the agentId from the Registered event.
 *   3. Calls setDeliverySigner on the Delivered contract.
 *   4. Calls registerProvider(agentId, payoutAddress) on the Delivered contract.
 *
 * Required env:
 *   PROVIDER_KEY    — private key of the provider wallet (never logged)
 *   PAYOUT_ADDRESS  — where USDC goes on job completion (defaults to the provider address)
 *   NETWORK         — "testnet" (default) | "mainnet"
 */

import { createWalletClient, createPublicClient, http, parseEventLogs } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { getConfig, getNetwork, explorerTx, explorerAddr } from './config'

// ── Config ──────────────────────────────────────────────────────────────────
const network = getNetwork()
const cfg = getConfig(network)

const providerKey = process.env.PROVIDER_KEY as `0x${string}` | undefined
if (!providerKey) { console.error('PROVIDER_KEY is required'); process.exit(1) }

const providerAccount = privateKeyToAccount(providerKey)
const providerAddress = providerAccount.address

// Viem client for Arc Testnet (or mainnet via same chain def pattern)
// For mainnet, pass the chain object that matches cfg.chainId. We use the
// arcTestnet viem chain for testnet and a minimal custom definition for mainnet.
const viemChain = cfg.chainId === 5042002
  ? arcTestnet
  : ({ id: cfg.chainId, name: cfg.name, nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [cfg.rpcUrl] } } } as unknown as typeof arcTestnet)

const publicClient = createPublicClient({ chain: viemChain, transport: http(cfg.rpcUrl) })
const walletClient = createWalletClient({ account: providerAccount, chain: viemChain, transport: http(cfg.rpcUrl) })

// ── Agent URI (data: URI so no hosting required) ────────────────────────────
const agentCard = {
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
  name: 'Delivered demo provider',
  description:
    'On-chain risk checks for agents: contract verification, honeypot test, holder concentration, pool liquidity, TVL, stablecoins, lending rates, large transfers.',
  services: [{ name: 'Delivered gateway', endpoint: cfg.gateway, version: '1.0.0' }],
  x402Support: false,
  active: true,
}
const AGENT_URI = `data:application/json;base64,${Buffer.from(JSON.stringify(agentCard)).toString('base64')}`

// ── ABIs ────────────────────────────────────────────────────────────────────
const IDENTITY_ABI = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'Registered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'agentURI', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
] as const

const DELIVERED_ABI = [
  {
    type: 'function',
    name: 'setDeliverySigner',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newSigner', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'registerProvider',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'payoutAddress', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'providerInfo',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'payoutAddress', type: 'address' },
    ],
  },
] as const

// ── Helpers ──────────────────────────────────────────────────────────────────
async function sendAndWait(hash: `0x${string}`, label: string) {
  console.log(`  ${label} tx: ${explorerTx(cfg, hash)}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${label} reverted`)
  console.log(`  confirmed in block ${receipt.blockNumber}`)
  return receipt
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const payoutAddress = (process.env.PAYOUT_ADDRESS ?? providerAddress) as `0x${string}`

  console.log(`\nNetwork:          ${cfg.name}`)
  console.log(`Provider address: ${explorerAddr(cfg, providerAddress)}`)
  console.log(`Payout address:   ${explorerAddr(cfg, payoutAddress)}`)
  console.log(`Contract:         ${explorerAddr(cfg, cfg.deliveredAddress)}`)
  console.log(`Identity registry:${explorerAddr(cfg, cfg.identityRegistry)}`)

  // ── Step 1: Register ERC-8004 identity ──────────────────────────────────
  console.log('\n[1/3] Registering ERC-8004 identity...')
  const regHash = await walletClient.writeContract({
    address: cfg.identityRegistry,
    abi: IDENTITY_ABI,
    functionName: 'register',
    args: [AGENT_URI],
  })
  const regReceipt = await sendAndWait(regHash, 'register')

  // Parse agentId from Registered event
  const [regEvent] = parseEventLogs({
    abi: IDENTITY_ABI,
    eventName: 'Registered',
    logs: regReceipt.logs,
  })
  if (!regEvent) throw new Error('Could not find Registered event in receipt')
  const agentId = regEvent.args.agentId
  console.log(`  agentId: ${agentId}`)

  // ── Step 2: setDeliverySigner ────────────────────────────────────────────
  console.log('\n[2/3] Setting delivery signer...')
  const signerHash = await walletClient.writeContract({
    address: cfg.deliveredAddress,
    abi: DELIVERED_ABI,
    functionName: 'setDeliverySigner',
    args: [cfg.deliverySigner],
  })
  await sendAndWait(signerHash, 'setDeliverySigner')

  // ── Step 3: registerProvider ──────────────────────────────────────────────
  console.log('\n[3/3] Registering provider...')
  const regProvHash = await walletClient.writeContract({
    address: cfg.deliveredAddress,
    abi: DELIVERED_ABI,
    functionName: 'registerProvider',
    args: [agentId, payoutAddress],
  })
  await sendAndWait(regProvHash, 'registerProvider')

  // ── Verify on-chain state ─────────────────────────────────────────────────
  console.log('\n[verify] Reading providerInfo...')
  const info = await publicClient.readContract({
    address: cfg.deliveredAddress,
    abi: DELIVERED_ABI,
    functionName: 'providerInfo',
    args: [providerAddress],
  })
  console.log(`  agentId:       ${info[0]}`)
  console.log(`  payoutAddress: ${info[1]}`)

  console.log('\n=== Setup complete ===')
  console.log(`Network:          ${cfg.name}`)
  console.log(`Contract:         ${cfg.deliveredAddress}`)
  console.log(`Provider address: ${providerAddress}`)
  console.log(`Payout address:   ${payoutAddress}`)
  console.log(`Agent ID:         ${agentId}`)
  console.log(`Delivery signer:  ${cfg.deliverySigner}`)
  console.log('\nAdd these to src/lib/delivered-config.ts:')
  console.log(`  PROVIDER_ADDRESS   = "${providerAddress}"`)
  console.log(`  PROVIDER_AGENT_ID  = ${agentId}n`)
}

main().catch((e) => { console.error(e); process.exit(1) })
