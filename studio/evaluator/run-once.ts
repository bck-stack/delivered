/**
 * Node script — run one evaluator pass locally.
 *
 * Run:
 *   EVALUATOR_KEY=0x… npx tsx evaluator/run-once.ts
 *   EVALUATOR_KEY=0x… NETWORK=mainnet npx tsx evaluator/run-once.ts
 *
 * Required env:
 *   EVALUATOR_KEY  — private key (never logged)
 *   NETWORK        — "testnet" (default) | "mainnet"
 *   NEBIUS_API_KEY — optional; turns on the Nemotron review
 */

import { runPass, type EvaluationRecord, type KVStore } from './evaluate'
import { getConfig, getNetwork } from '../scripts/config'
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from './judge'

const evaluatorKey = process.env.EVALUATOR_KEY as `0x${string}` | undefined
if (!evaluatorKey) { console.error('EVALUATOR_KEY is required'); process.exit(1) }

const cfg = getConfig(getNetwork())

// In-memory KV store backed by a plain object (persists only for this run).
// For a real persistent Node process, replace with a file or database.
const store: Record<string, string> = {}
const kv: KVStore = {
  get: (k) => Promise.resolve(store[k] ?? null),
  put: (k, v) => { store[k] = v; return Promise.resolve() },
}

async function main() {
  console.log(`[run-once] network: ${cfg.name}`)
  console.log(`[run-once] contract: ${cfg.deliveredAddress}`)
  console.log(`[run-once] gateway: ${cfg.gateway}`)

  await runPass({
    rpcUrl: cfg.rpcUrl,
    contractAddress: cfg.deliveredAddress,
    gateway: cfg.gateway,
    evaluatorKey,
    kv,
    judge: process.env.NEBIUS_API_KEY
      ? { apiKey: process.env.NEBIUS_API_KEY, model: process.env.NEMOTRON_MODEL ?? DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL }
      : undefined,
  })

  // Print any decisions made this run
  const decisions = Object.entries(store)
    .filter(([k]) => k.startsWith('eval:'))
    .map(([, v]) => JSON.parse(v) as EvaluationRecord)

  if (decisions.length === 0) {
    console.log('[run-once] no decisions made this run')
  } else {
    console.log(`[run-once] decisions this run:`)
    for (const d of decisions) {
      console.log(`  job ${d.jobId}: ${d.decision} — ${d.reason} (tx ${d.txHash})`)
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
