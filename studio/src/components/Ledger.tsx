import { useState, useEffect } from 'react'
import { createPublicClient, http } from 'viem'
import { CHAIN, CHAIN_ID, DELIVERED_ADDRESS, GATEWAY_URL, EVALUATOR_URL, buildTxExplorerUrl } from '@/lib/delivered-config'
import { DELIVERED_ABI } from '@/lib/delivered-abi'
import { formatAddress, formatUsdc, statusLabel, statusColor, timeAgo, shortHash } from '@/lib/utils'
import { ExternalLink, RefreshCw } from 'lucide-react'

interface JobRow {
  jobId: bigint
  client: string
  amount: bigint
  status: number
  expiry: bigint
  txHash: string
  checkTitle?: string
  evalReason?: string
}

const publicClient = createPublicClient({ chain: CHAIN, transport: http() })

type JobTuple = readonly [bigint, string, string, string, string, `0x${string}`, `0x${string}`, bigint, bigint, bigint, number, number]

/** Jobs are numbered 1, 2, 3… on the contract, so the ledger reads them by id instead of scanning event logs:
 * Arc's RPC only takes narrow log ranges and blocks come fast, so a log window soon leaves old jobs out. */
async function fetchJobRows(): Promise<JobRow[]> {
  const jobs: JobTuple[] = []
  for (let id = 1n; id <= 500n; id++) {
    const job = await publicClient.readContract({
      address: DELIVERED_ADDRESS,
      abi: DELIVERED_ABI,
      functionName: 'jobs',
      args: [id],
    }) as JobTuple
    if (job[0] === 0n) break
    jobs.push(job)
  }

  return Promise.all(
    jobs.reverse().map(async (job) => {
      const jobId = job[0]
      // Check name from the gateway's stored delivery
      let checkTitle: string | undefined
      try {
        const r = await fetch(`${GATEWAY_URL}/delivery/${String(jobId)}`)
        if (r.ok) checkTitle = ((await r.json()) as { tool?: string }).tool
      } catch { /* ignore */ }

      // The evaluator's reason and its complete/reject transaction
      let evalReason: string | undefined
      let txHash = ''
      if (EVALUATOR_URL) {
        try {
          const r = await fetch(`${EVALUATOR_URL as string}/evaluations/${String(jobId)}`)
          if (r.ok) {
            const d = await r.json() as { reason?: string; txHash?: string }
            evalReason = d.reason
            txHash = d.txHash ?? ''
          }
        } catch { /* ignore */ }
      }

      return { jobId, client: job[1], amount: job[7], status: job[11], expiry: job[8], txHash, checkTitle, evalReason }
    }),
  )
}

export function Ledger() {
  const [rows, setRows] = useState<JobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    setError('')
    fetchJobRows()
      .then(setRows)
      .catch((e: unknown) => setError(String((e as Error).message)))
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, []) // load is stable (useCallback [])

  return (
    <section className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between">
        <h2
          className="display text-xl font-semibold"
          style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}
        >
          Ledger
        </h2>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
          style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
        >
          <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <p className="mb-3 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>
      )}

      {!loading && rows.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>No jobs found yet.</p>
      )}

      <div className="space-y-2">
        {rows.map((row) => {
          const txUrl = row.txHash ? buildTxExplorerUrl(CHAIN_ID, row.txHash) ?? '#' : '#'
          return (
            <div
              key={String(row.jobId)}
              className="flex flex-col gap-1 rounded-2xl p-4"
              style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                  Job #{String(row.jobId)}{row.checkTitle ? ` — ${row.checkTitle}` : ''}
                </span>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{
                    background: 'var(--surface-muted)',
                    color: statusColor(row.status),
                  }}
                >
                  {statusLabel(row.status)}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs" style={{ color: 'var(--muted)' }}>
                <span className="mono">{formatAddress(row.client)}</span>
                <span className="tabular-nums">${formatUsdc(row.amount)} USDC</span>
                <span>{timeAgo(Number(row.expiry) - 1800)}</span>
                {row.status === 2 && <span>Waiting for the evaluator, usually 3 to 5 minutes</span>}
                {row.txHash && (
                  <a
                    href={txUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-0.5"
                    style={{ color: 'var(--accent-hover)' }}
                  >
                    {shortHash(row.txHash)}
                    <ExternalLink className="size-2.5" />
                  </a>
                )}
              </div>
              {row.evalReason && (
                <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
                  Evaluator: {row.evalReason}
                </p>
              )}
            </div>
          )
        })}
      </div>
      {loading && (
        <p className="mt-4 text-xs" style={{ color: 'var(--muted)' }}>Loading jobs…</p>
      )}
    </section>
  )
}
