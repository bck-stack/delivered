/**
 * End-to-end smoke test for the Delivered protocol.
 *
 * Run (do NOT run automatically — read this first):
 *   BUYER_KEY=0x… EVALUATOR_KEY=0x… npx tsx scripts/e2e.ts
 *   BUYER_KEY=0x… EVALUATOR_KEY=0x… NETWORK=mainnet npx tsx scripts/e2e.ts
 *
 * What it tests:
 *   Scenario A (happy path):
 *     /menu → pick honeypot-detector → /request-hash →
 *     approve USDC + createAndFundJob → POST /deliver →
 *     submitWithSignature (buyer) → evaluator pass →
 *     print job state + provider stats
 *
 *   Scenario B (admitted failure):
 *     honeypot-detector with a random non-token address →
 *     POST /deliver (expects status=1 failed) →
 *     submitWithSignature → claimRefund (buyer)
 *
 * Required env:
 *   BUYER_KEY       — private key of the buyer wallet
 *   EVALUATOR_KEY   — private key of the evaluator wallet
 *   PROVIDER_ADDR   — provider's registered address (set in delivered-config.ts after setup)
 *   EVALUATOR_ADDR  — evaluator's address (derived from EVALUATOR_KEY)
 *   NETWORK         — "testnet" (default) | "mainnet"
 *
 * Note: The buyer and the provider must have USDC on the target network.
 * Use the Arc Studio "Get test USDC" sidebar button for testnet funds.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  erc20Abi,
  decodeEventLog,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { getConfig, getNetwork, explorerTx } from './config'
import { runPass } from '../evaluator/evaluate'

// ── Setup ───────────────────────────────────────────────────────────────────
const network = getNetwork()
const cfg = getConfig(network)

function requireKey(name: string): `0x${string}` {
  const k = process.env[name]
  if (!k) { console.error(`${name} is required`); process.exit(1) }
  return k as `0x${string}`
}

const buyerKey     = requireKey('BUYER_KEY')
const evaluatorKey = requireKey('EVALUATOR_KEY')

const buyerAccount     = privateKeyToAccount(buyerKey)
const evaluatorAccount = privateKeyToAccount(evaluatorKey)

const providerAddr   = (process.env.PROVIDER_ADDR   ?? '') as `0x${string}`
const evaluatorAddr  = evaluatorAccount.address

if (!providerAddr) { console.error('PROVIDER_ADDR is required (run setup-provider.ts first)'); process.exit(1) }

const viemChain = cfg.chainId === 5042002 ? arcTestnet : arcTestnet // swap for mainnet chain if needed
const publicClient  = createPublicClient({ chain: viemChain, transport: http(cfg.rpcUrl) })
const buyerClient   = createWalletClient({ account: buyerAccount,     chain: viemChain, transport: http(cfg.rpcUrl) })

const usdcAddress = cfg.usdcAddress
const contractAddress = cfg.deliveredAddress

// ── Minimal ABI ─────────────────────────────────────────────────────────────
const DELIVERED_ABI = [
  {
    type: 'function',
    name: 'createAndFundJob',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'provider',     type: 'address' },
      { name: 'evaluator',    type: 'address' },
      { name: 'expiry',       type: 'uint64'  },
      { name: 'requestHash',  type: 'bytes32' },
      { name: 'amount',       type: 'uint256' },
    ],
    outputs: [{ name: 'jobId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'submitWithSignature',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId',        type: 'uint256' },
      { name: 'responseHash', type: 'bytes32' },
      { name: 'status',       type: 'uint8'   },
      { name: 'deliveredAt',  type: 'uint64'  },
      { name: 'signature',    type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claimRefund',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'jobs',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'id',                  type: 'uint256' },
      { name: 'client',              type: 'address' },
      { name: 'provider',            type: 'address' },
      { name: 'evaluator',           type: 'address' },
      { name: 'payoutAddress',       type: 'address' },
      { name: 'requestHash',         type: 'bytes32' },
      { name: 'deliveryResponseHash',type: 'bytes32' },
      { name: 'amount',              type: 'uint256' },
      { name: 'expiry',              type: 'uint64'  },
      { name: 'submittedAt',         type: 'uint64'  },
      { name: 'deliveryStatus',      type: 'uint8'   },
      { name: 'status',              type: 'uint8'   },
    ],
  },
  {
    type: 'function',
    name: 'getProviderStats',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      {
        name: 'stats',
        type: 'tuple',
        components: [
          { name: 'jobsCompleted',         type: 'uint64' },
          { name: 'jobsRejected',          type: 'uint64' },
          { name: 'jobsFailedAdmitted',    type: 'uint64' },
          { name: 'jobsExpired',           type: 'uint64' },
          { name: 'jobsEvaluatorTimeout',  type: 'uint64' },
          { name: 'usdcEarned',            type: 'uint128'},
        ],
      },
      { name: 'score', type: 'uint8' },
    ],
  },
  {
    type: 'event',
    name: 'JobCreated',
    inputs: [
      { name: 'jobId',       type: 'uint256', indexed: true  },
      { name: 'client',      type: 'address', indexed: true  },
      { name: 'provider',    type: 'address', indexed: true  },
      { name: 'evaluator',   type: 'address', indexed: false },
      { name: 'requestHash', type: 'bytes32', indexed: false },
      { name: 'amount',      type: 'uint256', indexed: false },
      { name: 'expiry',      type: 'uint64',  indexed: false },
    ],
  },
] as const

// ── Helpers ──────────────────────────────────────────────────────────────────
const STATUS_LABELS = ['Created','Funded','Submitted','Completed','Rejected','Expired']

async function tx(label: string, hash: `0x${string}`) {
  console.log(`  ${label}: ${explorerTx(cfg, hash)}`)
  const r = await publicClient.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`${label} reverted`)
  return r
}

async function getMenu() {
  const r = await fetch(`${cfg.gateway}/menu`)
  if (!r.ok) throw new Error(`GET /menu failed: ${r.status}`)
  return (await r.json() as { checks: Array<{ id: string; title: string; price: number; inputs: string[]; example: Record<string,string> }> }).checks
}

async function getRequestHash(tool: string, input: Record<string,string>) {
  const r = await fetch(`${cfg.gateway}/request-hash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, input }),
  })
  if (!r.ok) throw new Error(`POST /request-hash failed: ${r.status}`)
  return (await r.json() as { requestHash: string }).requestHash as `0x${string}`
}

async function deliver(jobId: bigint, tool: string, input: Record<string,string>) {
  const r = await fetch(`${cfg.gateway}/deliver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: String(jobId), tool, input }),
  })
  if (!r.ok) throw new Error(`POST /deliver failed: ${r.status} ${await r.text()}`)
  return r.json() as Promise<{
    delivered: boolean
    receipt: { jobId: string; requestHash: string; responseHash: string; status: number; deliveredAt: number }
    signature: string
  }>
}

async function approveAndFund(
  tool: string,
  input: Record<string,string>,
  label: string,
): Promise<bigint> {
  console.log(`\n── ${label} ──`)

  const menu = await getMenu()
  const check = menu.find((c) => c.id === tool)
  if (!check) throw new Error(`Tool "${tool}" not found in menu`)
  console.log(`  tool: ${check.title} — $${(check.price / 1e6).toFixed(4)} USDC`)

  const reqHash = await getRequestHash(tool, input)
  console.log(`  requestHash: ${reqHash}`)

  const amount = BigInt(check.price)
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 30 * 60)

  // Approve
  const approveHash = await buyerClient.writeContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: 'approve',
    args: [contractAddress, amount],
  })
  await tx('approve', approveHash)

  // Create + fund
  const fundHash = await buyerClient.writeContract({
    address: contractAddress,
    abi: DELIVERED_ABI,
    functionName: 'createAndFundJob',
    args: [providerAddr, evaluatorAddr, expiry, reqHash, amount],
  })
  const fundReceipt = await tx('createAndFundJob', fundHash)

  // Extract jobId
  let jobId = 0n
  for (const log of fundReceipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: DELIVERED_ABI, eventName: 'JobCreated', data: log.data, topics: log.topics })
      jobId = (decoded.args as { jobId: bigint }).jobId
      break
    } catch { /* try next */ }
  }
  if (!jobId) throw new Error('Could not extract jobId')
  console.log(`  jobId: ${jobId}`)
  return jobId
}

// ── In-memory KV for the evaluator pass ──────────────────────────────────────
const kvStore: Record<string,string> = {}

// ── Scenario A: happy path ───────────────────────────────────────────────────
async function scenarioA() {
  const menu = await getMenu()
  const honeypot = menu.find((c) => c.id === 'honeypot-detector')
  if (!honeypot) throw new Error('honeypot-detector not in menu')

  const input = { ...honeypot.example }
  const jobId = await approveAndFund('honeypot-detector', input, 'Scenario A — happy path')

  // Deliver
  console.log('\n  requesting delivery...')
  const d = await deliver(jobId, 'honeypot-detector', input)
  console.log(`  delivered: ${d.delivered}, receipt.status: ${d.receipt.status}`)

  // Submit receipt
  const submitHash = await buyerClient.writeContract({
    address: contractAddress,
    abi: DELIVERED_ABI,
    functionName: 'submitWithSignature',
    args: [
      jobId,
      d.receipt.responseHash as `0x${string}`,
      d.receipt.status,
      BigInt(d.receipt.deliveredAt),
      d.signature as `0x${string}`,
    ],
  })
  await tx('submitWithSignature', submitHash)

  // Run evaluator pass
  console.log('\n  running evaluator pass...')
  await runPass({
    rpcUrl: cfg.rpcUrl,
    contractAddress: cfg.deliveredAddress,
    gateway: cfg.gateway,
    evaluatorKey,
    kv: {
      get: (k) => Promise.resolve(kvStore[k] ?? null),
      put: (k, v) => { kvStore[k] = v; return Promise.resolve() },
    },
  })

  // Print final state
  const job = await publicClient.readContract({
    address: contractAddress, abi: DELIVERED_ABI, functionName: 'jobs', args: [jobId],
  }) as readonly [bigint, string, string, string, string, `0x${string}`, `0x${string}`, bigint, bigint, bigint, number, number]
  console.log(`\n  Final job status: ${STATUS_LABELS[job[11]] ?? job[11]}`)

  const providerResult = await publicClient.readContract({
    address: contractAddress, abi: DELIVERED_ABI, functionName: 'getProviderStats', args: [providerAddr],
  }) as readonly [{ jobsCompleted: bigint; jobsRejected: bigint; jobsExpired: bigint; usdcEarned: bigint }, number]
  const stats = providerResult[0]
  const score = providerResult[1]
  console.log(`  Provider score:  ${score}/100`)
  console.log(`  Completed: ${stats.jobsCompleted}  Rejected: ${stats.jobsRejected}  Expired: ${stats.jobsExpired}`)
  console.log(`  USDC earned: $${(Number(stats.usdcEarned) / 1e6).toFixed(4)}`)
}

// ── Scenario B: admitted failure ─────────────────────────────────────────────
async function scenarioB() {
  // Use a random address that is not a token — the provider will return status=1
  const randomAddr = `0x${Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`
  const input = { address: randomAddr }
  const jobId = await approveAndFund('honeypot-detector', input, 'Scenario B — admitted failure')

  // Deliver
  console.log('\n  requesting delivery...')
  const d = await deliver(jobId, 'honeypot-detector', input)
  console.log(`  delivered: ${d.delivered}, receipt.status: ${d.receipt.status}`)

  // Submit with potentially failed status
  const submitHash = await buyerClient.writeContract({
    address: contractAddress,
    abi: DELIVERED_ABI,
    functionName: 'submitWithSignature',
    args: [
      jobId,
      d.receipt.responseHash as `0x${string}`,
      d.receipt.status,
      BigInt(d.receipt.deliveredAt),
      d.signature as `0x${string}`,
    ],
  })
  await tx('submitWithSignature', submitHash)

  // If status == 1 (admitted failure), claim refund immediately
  if (d.receipt.status === 1) {
    console.log('\n  admitted failure — claiming refund...')
    const refundHash = await buyerClient.writeContract({
      address: contractAddress,
      abi: DELIVERED_ABI,
      functionName: 'claimRefund',
      args: [jobId],
    })
    await tx('claimRefund', refundHash)
    console.log('  refund sent.')
  } else {
    console.log('\n  delivery succeeded (provider found token data) — no refund needed for this run')
  }

  const job = await publicClient.readContract({
    address: contractAddress, abi: DELIVERED_ABI, functionName: 'jobs', args: [jobId],
  }) as readonly [bigint, string, string, string, string, `0x${string}`, `0x${string}`, bigint, bigint, bigint, number, number]
  console.log(`  Final job status: ${STATUS_LABELS[job[11]] ?? job[11]}`)
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`=== Delivered e2e — ${cfg.name} ===`)
  console.log(`Contract:  ${cfg.deliveredAddress}`)
  console.log(`Buyer:     ${buyerAccount.address}`)
  console.log(`Evaluator: ${evaluatorAddr}`)
  console.log(`Provider:  ${providerAddr}`)

  await scenarioA()
  console.log('\n' + '─'.repeat(60))
  await scenarioB()
  console.log('\n=== e2e done ===')
}

main().catch((e) => { console.error(e); process.exit(1) })
