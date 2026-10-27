/**
 * Cloudflare Worker — evaluator agent.
 *
 * Cron trigger: every minute (wrangler.toml).
 * Routes:
 *   GET  /evaluations        → latest 100 evaluation records
 *   GET  /evaluations/:jobId → single record for a job
 *
 * Secrets (set with `wrangler secret put`):
 *   EVALUATOR_KEY  — private key of the evaluator wallet (never logged)
 *
 * KV binding: EVALUATIONS (declared in wrangler.toml)
 * All env vars below can be overridden via wrangler.toml [vars] or secrets.
 */

import { runPass, type EvaluationRecord, type KVStore } from './evaluate'

export interface Env {
  EVALUATIONS: KVNamespace
  EVALUATOR_KEY: string
  // Override via wrangler.toml [vars] — defaults below are for Arc Testnet
  RPC_URL?: string
  CONTRACT_ADDRESS?: string
  GATEWAY_URL?: string
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
}

// Default RPC and contract address — Arc Testnet. Override via wrangler.toml vars.
// arc-studio-allow-onchain-literal
const DEFAULT_RPC = 'https://rpc.testnet.arc.io'
// arc-studio-allow-onchain-literal
const DEFAULT_CONTRACT = '0x72d179ba5fedf0e6f24c0030afe66d21b5de9904'
const DEFAULT_GATEWAY  = 'https://delivered.chainmarket-api.workers.dev'

function kvStore(ns: KVNamespace): KVStore {
  return {
    get: (k) => ns.get(k),
    put: (k, v) => ns.put(k, v),
  }
}

export default {
  // ── Cron trigger (every minute) ──────────────────────────────────────────
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runPass({
      rpcUrl:           env.RPC_URL          ?? DEFAULT_RPC,
      contractAddress: (env.CONTRACT_ADDRESS ?? DEFAULT_CONTRACT) as `0x${string}`,
      gateway:          env.GATEWAY_URL       ?? DEFAULT_GATEWAY,
      evaluatorKey:     env.EVALUATOR_KEY as `0x${string}`,
      kv:               kvStore(env.EVALUATIONS),
    })
  },

  // ── HTTP routes ───────────────────────────────────────────────────────────
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    const url = new URL(request.url)
    const path = url.pathname

    // GET /evaluations/:jobId
    const singleMatch = path.match(/^\/evaluations\/(\d+)$/)
    if (singleMatch) {
      const jobId = singleMatch[1]
      const val = await env.EVALUATIONS.get(`eval:${jobId}`)
      if (!val) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: CORS })
      return new Response(val, { status: 200, headers: CORS })
    }

    // GET /evaluations
    if (path === '/evaluations' || path === '/evaluations/') {
      const list = await env.EVALUATIONS.list({ prefix: 'eval:' })
      const records: EvaluationRecord[] = []
      for (const key of list.keys.slice(-100)) {
        const val = await env.EVALUATIONS.get(key.name)
        if (val) records.push(JSON.parse(val) as EvaluationRecord)
      }
      records.sort((a, b) => b.at - a.at)
      return new Response(JSON.stringify(records), { status: 200, headers: CORS })
    }

    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: CORS })
  },
}
