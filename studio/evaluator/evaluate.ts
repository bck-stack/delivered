/**
 * Core evaluation logic — shared between the Worker and the Node script.
 *
 * For each job where the evaluator address matches ours and status == Submitted:
 *   1. Fetch the delivery record from the gateway.
 *   2. Verify every acceptance criterion.
 *   3. Call complete() or reject() on the contract.
 *   4. Persist the decision in KV (or in-memory for the Node script).
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type PublicClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { DELIVERED_ABI } from './abi'

// ── Types ──────────────────────────────────────────────────────────────────

export interface EvaluationRecord {
  jobId: string
  decision: 'complete' | 'reject'
  reason: string
  txHash: string
  at: number
}

export interface KVStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

interface GatewayDelivery {
  jobId: string
  tool: string
  input: Record<string, string>
  delivered: boolean
  response: Record<string, unknown>
  receipt: {
    jobId: string
    requestHash: string
    responseHash: string
    status: number       // 0 = delivered, 1 = failed
    deliveredAt: number
  }
  signature: string
  signer: string
}

// ── Key-field presence by check ID ────────────────────────────────────────
const REQUIRED_FIELDS: Record<string, string> = {
  'smart-contract-verify':      'verified',
  'honeypot-detector':          'address',
  'token-holder-concentration': 'address',
  'dex-pool-liquidity':         'pairAddress', // also accept "pool"
  'defillama-tvl-oracle':       'tvlUsd',
  'defillama-stablecoins':      'stablecoins',
  'aave-lending-markets':       'reserves',
  'whale-alert-transfers':      'transfers',
}

function hasRequiredField(tool: string, response: Record<string, unknown>): boolean {
  const field = REQUIRED_FIELDS[tool]
  if (!field) return true // unknown tool: trust the delivered flag
  if (tool === 'dex-pool-liquidity') {
    return field in response || 'pool' in response
  }
  return field in response
}

// ── Request hash recomputation ─────────────────────────────────────────────
function computeRequestHash(tool: string, input: Record<string, string>): `0x${string}` {
  const sorted = Object.fromEntries(
    Object.entries(input).sort(([a], [b]) => a.localeCompare(b))
  )
  return keccak256(toBytes(JSON.stringify([tool, sorted])))
}

// ── Response hash ──────────────────────────────────────────────────────────
function computeResponseHash(response: Record<string, unknown>): `0x${string}` {
  return keccak256(toBytes(JSON.stringify(response)))
}

// ── Single-job evaluation ──────────────────────────────────────────────────
async function evaluateJob(
  jobId: bigint,
  onChainJob: {
    evaluator: string
    requestHash: `0x${string}`
    deliveryResponseHash: `0x${string}`
    status: number
  },
  gateway: string,
  evaluatorAddress: string,
): Promise<{ decision: 'complete' | 'reject' | 'wait'; reason: string }> {
  // Only act on our own jobs that are Submitted (status == 2)
  if (onChainJob.evaluator.toLowerCase() !== evaluatorAddress.toLowerCase()) {
    return { decision: 'wait', reason: 'not our job' }
  }
  if (onChainJob.status !== 2) {
    return { decision: 'wait', reason: `status is ${onChainJob.status}, not Submitted` }
  }

  // Fetch delivery record
  let delivery: GatewayDelivery | null = null
  try {
    const r = await fetch(`${gateway}/delivery/${jobId}`)
    if (r.status === 404) return { decision: 'wait', reason: 'no delivery record yet' }
    if (!r.ok) return { decision: 'wait', reason: `gateway error ${r.status}` }
    delivery = await r.json() as GatewayDelivery
  } catch {
    return { decision: 'wait', reason: 'gateway unreachable' }
  }

  // (a) receipt.jobId must match
  if (String(delivery.receipt.jobId) !== String(jobId)) {
    return { decision: 'reject', reason: `receipt jobId mismatch: got ${delivery.receipt.jobId}` }
  }

  // (a) receipt.requestHash must match on-chain requestHash
  if (delivery.receipt.requestHash.toLowerCase() !== onChainJob.requestHash.toLowerCase()) {
    return { decision: 'reject', reason: 'receipt requestHash mismatch' }
  }

  // (b) keccak256(response) must equal deliveryResponseHash
  const computedResponseHash = computeResponseHash(delivery.response)
  if (computedResponseHash.toLowerCase() !== onChainJob.deliveryResponseHash.toLowerCase()) {
    return { decision: 'reject', reason: 'response hash mismatch' }
  }

  // (c) status == 0 and delivered == true
  if (delivery.receipt.status !== 0 || !delivery.delivered) {
    return { decision: 'reject', reason: `delivery status=${delivery.receipt.status} delivered=${delivery.delivered}` }
  }

  // (d) response is non-empty object, no "error" field, has required key field
  if (
    !delivery.response ||
    typeof delivery.response !== 'object' ||
    Object.keys(delivery.response).length === 0 ||
    'error' in delivery.response
  ) {
    return { decision: 'reject', reason: 'response is empty or contains an error field' }
  }
  if (!hasRequiredField(delivery.tool, delivery.response)) {
    return { decision: 'reject', reason: `response missing required field for ${delivery.tool}` }
  }

  // (e) recomputed requestHash from [tool, sorted input] must equal on-chain requestHash
  const recomputed = computeRequestHash(delivery.tool, delivery.input)
  if (recomputed.toLowerCase() !== onChainJob.requestHash.toLowerCase()) {
    return { decision: 'reject', reason: 'requestHash does not match tool+input' }
  }

  return { decision: 'complete', reason: 'all criteria met' }
}

// ── Main pass ──────────────────────────────────────────────────────────────

export async function runPass(opts: {
  rpcUrl: string
  contractAddress: `0x${string}`
  gateway: string
  evaluatorKey: `0x${string}`
  kv: KVStore
  lastBlockKey?: string
}): Promise<void> {
  const { rpcUrl, contractAddress, gateway, evaluatorKey, kv, lastBlockKey = 'lastBlock' } = opts

  const account = privateKeyToAccount(evaluatorKey)
  const evaluatorAddress = account.address

  const viemChain = arcTestnet // swap for mainnet chain when NETWORK=mainnet
  const publicClient: PublicClient = createPublicClient({
    chain: viemChain,
    transport: http(rpcUrl),
  })
  const walletClient = createWalletClient({
    account,
    chain: viemChain,
    transport: http(rpcUrl),
  })
  const writeContractChain = viemChain

  // Check gas balance
  const balance = await publicClient.getBalance({ address: evaluatorAddress })
  if (balance < 1_000_000n) {
    console.log(`[evaluator] low gas balance (${balance} wei) — skipping pass`)
    return
  }

  // Find DeliverySubmitted events since last processed block
  const head = await publicClient.getBlockNumber()
  const lastBlockStr = await kv.get(lastBlockKey)
  const fromBlock = lastBlockStr ? BigInt(lastBlockStr) + 1n : (head > 10000n ? head - 10000n : 0n)
  // Arc's public RPC refuses log queries over a wide block range, so the scan goes in steps,
  // and a pass that falls far behind catches up over the next passes.
  const STEP = 4000n
  const MAX_STEPS = 8n
  const toBlock = head - fromBlock > STEP * MAX_STEPS ? fromBlock + STEP * MAX_STEPS - 1n : head

  console.log(`[evaluator] scanning blocks ${fromBlock}…${toBlock} for DeliverySubmitted`)

  const logs: Awaited<ReturnType<typeof publicClient.getLogs>> = []
  for (let start = fromBlock; start <= toBlock; start += STEP) {
    const end = start + STEP - 1n > toBlock ? toBlock : start + STEP - 1n
    logs.push(...(await publicClient.getLogs({
      address: contractAddress,
      event: DELIVERED_ABI.find((x) => x.type === 'event' && x.name === 'DeliverySubmitted') as never,
      fromBlock: start,
      toBlock: end,
    })))
  }

  console.log(`[evaluator] found ${logs.length} DeliverySubmitted event(s)`)

  for (const log of logs) {
    const args = (log as unknown as { args: { jobId: bigint } }).args
    const jobId = args.jobId
    const kvKey = `eval:${jobId}`

    // Skip if already decided
    const existing = await kv.get(kvKey)
    if (existing) {
      console.log(`[evaluator] job ${jobId}: already decided, skipping`)
      continue
    }

    // Read job from chain
    let onChainJob: {
      evaluator: string
      requestHash: `0x${string}`
      deliveryResponseHash: `0x${string}`
      status: number
    }
    try {
      const raw = await publicClient.readContract({
        address: contractAddress,
        abi: DELIVERED_ABI,
        functionName: 'jobs',
        args: [jobId],
      }) as readonly [bigint, string, string, string, string, `0x${string}`, `0x${string}`, bigint, bigint, bigint, number, number]
      onChainJob = {
        evaluator: raw[3],
        requestHash: raw[5],
        deliveryResponseHash: raw[6],
        status: raw[11],
      }
    } catch (e) {
      console.log(`[evaluator] job ${jobId}: failed to read from chain — ${String(e)}`)
      continue
    }

    const { decision, reason } = await evaluateJob(jobId, onChainJob, gateway, evaluatorAddress)

    if (decision === 'wait') {
      console.log(`[evaluator] job ${jobId}: waiting — ${reason}`)
      continue
    }

    // Build reasonHash
    const reasonSentence = decision === 'complete'
      ? `Job ${jobId} completed: ${reason}`
      : `Job ${jobId} rejected: ${reason}`
    const reasonHash = keccak256(toBytes(reasonSentence))

    console.log(`[evaluator] job ${jobId}: ${decision} — ${reason}`)

    let txHash = ''
    try {
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: DELIVERED_ABI,
        functionName: decision,
        args: [jobId, reasonHash],
        chain: writeContractChain,
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('tx reverted')
      txHash = hash
      console.log(`[evaluator] job ${jobId}: ${decision} tx ${hash}`)
    } catch (e) {
      console.log(`[evaluator] job ${jobId}: tx failed — ${String(e)}`)
      continue
    }

    // Persist to KV
    const record: EvaluationRecord = {
      jobId: String(jobId),
      decision,
      reason: reasonSentence,
      txHash,
      at: Date.now(),
    }
    await kv.put(kvKey, JSON.stringify(record))
  }

  // Update last processed block
  await kv.put(lastBlockKey, String(toBlock))
}
