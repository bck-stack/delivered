import { useReadContract } from 'wagmi'
import { ExternalLink, TrendingUp } from 'lucide-react'
import { DELIVERED_ADDRESS, CHAIN_ID, PROVIDER_ADDRESS, PROVIDER_AGENT_ID, buildAddressExplorerUrl } from '@/lib/delivered-config'
import { DELIVERED_ABI } from '@/lib/delivered-abi'
import { formatUsdc, formatAddress } from '@/lib/utils'

const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const

export function ProviderScore() {
  const { data, isLoading } = useReadContract({
    address: DELIVERED_ADDRESS,
    abi: DELIVERED_ABI,
    functionName: 'getProviderStats',
    args: [PROVIDER_ADDRESS || '0x0000000000000000000000000000000000000001'],
    chainId: CHAIN_ID,
  })

  const stats = data?.[0]
  const score = data?.[1] ?? 50

  const counters = stats
    ? [
        { label: 'Completed', value: String(stats.jobsCompleted) },
        { label: 'Rejected', value: String(stats.jobsRejected) },
        { label: 'Failures admitted', value: String(stats.jobsFailedAdmitted) },
        { label: 'Expired', value: String(stats.jobsExpired) },
        { label: 'Evaluator timeout', value: String(stats.jobsEvaluatorTimeout) },
        { label: 'USDC earned', value: `$${formatUsdc(stats.usdcEarned)}` },
      ]
    : []

  const explorerAddr = PROVIDER_ADDRESS
    ? buildAddressExplorerUrl(CHAIN_ID, PROVIDER_ADDRESS) ?? '#'
    : '#'
  const registryAddr = buildAddressExplorerUrl(CHAIN_ID, IDENTITY_REGISTRY) ?? '#'

  if (!PROVIDER_ADDRESS) {
    return (
      <section className="mx-auto max-w-md px-4 py-8">
        <div
          className="rounded-3xl p-6"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Provider not set up yet. Run{' '}
            <span className="mono text-xs">scripts/setup-provider.ts</span>
            {' '}and fill in <span className="mono text-xs">PROVIDER_ADDRESS</span> in the config.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-md px-4 py-8">
      {/* Score card */}
      <div
        className="rounded-3xl p-6"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >
        <div className="mb-1 flex items-center gap-2">
          <TrendingUp className="size-4" style={{ color: 'var(--muted)' }} />
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
            Provider score
          </span>
        </div>

        {isLoading ? (
          <div className="display mt-1 text-7xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
            …
          </div>
        ) : (
          <div
            className="display mt-1 text-7xl font-bold tabular-nums"
            style={{
              color: score >= 70 ? 'var(--success)' : score >= 40 ? 'var(--ink)' : 'var(--danger)',
            }}
          >
            {score}
            <span className="text-2xl font-medium" style={{ color: 'var(--subtle)' }}>/100</span>
          </div>
        )}

        <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
          Checked before paying: a provider that fails to deliver loses score, not the buyer's money.
        </p>

        {/* Counter grid */}
        {counters.length > 0 && (
          <div className="mt-5 grid grid-cols-2 gap-2">
            {counters.map((c) => (
              <div
                key={c.label}
                className="rounded-xl p-3"
                style={{ background: 'var(--surface-muted)' }}
              >
                <div
                  className="text-xs font-medium tabular-nums"
                  style={{ color: 'var(--muted)' }}
                >
                  {c.label}
                </div>
                <div
                  className="display mt-0.5 text-lg font-bold tabular-nums"
                  style={{ color: 'var(--ink)' }}
                >
                  {c.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Provider identity links */}
        <div className="mt-5 space-y-1.5">
          {PROVIDER_ADDRESS && (
            <a
              href={explorerAddr}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs"
              style={{ color: 'var(--accent-hover)' }}
            >
              <span className="mono">{formatAddress(PROVIDER_ADDRESS)}</span>
              <ExternalLink className="size-3" />
            </a>
          )}
          {PROVIDER_AGENT_ID > 0n && (
            <a
              href={registryAddr}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs"
              style={{ color: 'var(--accent-hover)' }}
            >
              ERC-8004 identity #{String(PROVIDER_AGENT_ID)}
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>
    </section>
  )
}
