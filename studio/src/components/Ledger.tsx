import { useState, useEffect } from 'react'
import { createPublicClient, http, type Log } from 'viem'
import { CHAIN, CHAIN_ID, DELIVERED_ADDRESS, DEPLOY_BLOCK, GATEWAY_URL, EVALUATOR_URL, buildTxExplorerUrl } from '@/lib/delivered-config'
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

const JOB_CREATED = {
  type: 'event',
  name: 'JobCreated',
  inputs: [
    { name: 'jobId', type: 'uint256', indexed: true },
    { name: 'client', type: 'address', indexed: true },
    { name: 'provider', type: 'address', indexed: true },
    { name: 'evaluator', type: 'address', indexed: false },
    { name: 'requestHash', type: 'bytes32', indexed: false },
    { name: 'amount', type: 'uint256', indexed: false },
    { name: 'expiry', type: 'uint64', indexed: false },
  ],
} as const

async function fetchJobRows(): Promise<JobRow[]> {
  // Get block range from current head minus lookback, never before the deployment
  const head = await publicClient.getBlockNumber()
  const from = head > DEPLOY_BLOCK + 50000n ? head - 50000n : DEPLOY_BLOCK

  // Arc's public RPC refuses wide log ranges, so the scan goes in steps
  const logs: Log[] = []
  for (let start = from; start <= head; start += 4000n) {
    const end = start + 3999n > head ? head : start + 3999n
    logs.push(...(await publicClient.getLogs({ address: DELIVERED_ADDRESS, event: JOB_CREATED, fromBlock: start, toBlock: end })))
  }

  const rows: JobRow[] = []
  for (const log of logs.reverse()) {
    const args = (log as Log & { args: { jobId: bigint; client: string; amount: bigint; expiry: bigint } }).args
    // Read live status
    let status = 1 // Funded as default
    try {
      const job = await publicClient.readContract({
        address: DELIVERED_ADDRESS,
        abi: DELIVERED_ABI,
        functionName: 'jobs',
        args: [args.jobId],
      }) as readonly [bigint, string, string, string, string, `0x${string}`, `0x${string}`, bigint, bigint, bigint, number, number]
      status = job[11]
    } catch {
      // ignore
    }

    // Try to get check title from gateway
    let checkTitle: string | undefined
    try {
      const r = await fetch(`${GATEWAY_URL}/delivery/${String(args.jobId)}`)
      if (r.ok) {
        const d = await r.json() as { tool?: string }
        checkTitle = d.tool
      }
    } catch { /* ignore */ }

    // Try to get evaluator reason
    let evalReason: string | undefined
    if (EVALUATOR_URL) {
      try {
        const r = await fetch(`${EVALUATOR_URL as string}/evaluations/${String(args.jobId)}`)
        if (r.ok) {
          const d = await r.json() as { reason?: string }
          evalReason = d.reason
        }
      } catch { /* ignore */ }
    }

    rows.push({
      jobId: args.jobId,
      client: args.client,
      amount: args.amount,
      status,
      expiry: args.expiry,
      txHash: log.transactionHash ?? '',
      checkTitle,
      evalReason,
    })
  }
  return rows
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
