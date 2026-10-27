import { useState, useCallback } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useReadContract } from 'wagmi'
import { erc20Abi, decodeEventLog } from 'viem'
import { ConnectKitButton } from 'connectkit'
import { Loader2, ExternalLink, ChevronDown, ChevronUp, AlertCircle, CheckCircle2 } from 'lucide-react'
import { DELIVERED_ADDRESS, CHAIN_ID, PROVIDER_ADDRESS, DEFAULT_EVALUATOR, GATEWAY_URL, JOB_EXPIRY_SECONDS, buildTxExplorerUrl } from '@/lib/delivered-config'
import { DELIVERED_ABI } from '@/lib/delivered-abi'
import { getUsdc } from '@/onchain-facts'
import { formatUsdc, parseOnchainError, shortHash } from '@/lib/utils'

const usdc = getUsdc(CHAIN_ID)!
const USDC_ADDRESS = usdc.address as `0x${string}`

interface Check {
  id: string
  title: string
  about: string
  price: number
  inputs: string[]
  example: Record<string, string>
}

interface DeliveryResponse {
  jobId: string
  tool: string
  delivered: boolean
  response: Record<string, unknown>
  receipt: {
    jobId: string
    requestHash: string
    responseHash: string
    status: number
    deliveredAt: number
  }
  signature: string
  signer: string
}

type Step =
  | 'connect'
  | 'pick'
  | 'inputs'
  | 'approve'
  | 'fund'
  | 'deliver'
  | 'submit'
  | 'done'

function TxLink({ hash }: { hash: string }) {
  const url = buildTxExplorerUrl(CHAIN_ID, hash) ?? '#'
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1 text-xs"
      style={{ color: 'var(--accent-hover)' }}
    >
      {shortHash(hash)} <ExternalLink className="size-3" />
    </a>
  )
}

function StepLabel({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        style={{
          background: done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--surface-muted)',
          color: done || active ? '#fff' : 'var(--muted)',
        }}
      >
        {done ? '✓' : n}
      </div>
      <span
        className="text-sm font-medium"
        style={{ color: active ? 'var(--ink)' : done ? 'var(--muted)' : 'var(--subtle)' }}
      >
        {label}
      </span>
    </div>
  )
}

export function BuyCheck() {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const wrongChain = isConnected && chainId !== CHAIN_ID

  const [step, setStep] = useState<Step>('connect')
  const [checks, setChecks] = useState<Check[]>([])
  const [menuError, setMenuError] = useState('')
  const [menuLoading, setMenuLoading] = useState(false)
  const [selected, setSelected] = useState<Check | null>(null)
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const [evaluator, setEvaluator] = useState<string>(DEFAULT_EVALUATOR)
  const [requestHash, setRequestHash] = useState<`0x${string}`>('0x')
  const [requestHashLoading, setRequestHashLoading] = useState(false)
  const [jobId, setJobId] = useState<bigint | null>(null)
  const [delivery, setDelivery] = useState<DeliveryResponse | null>(null)
  const [deliveryLoading, setDeliveryLoading] = useState(false)
  const [deliveryError, setDeliveryError] = useState('')
  const [rawOpen, setRawOpen] = useState(false)
  const [error, setError] = useState('')

  // Approve USDC
  const { writeContract: approve, data: approveHash, isPending: approvePending } = useWriteContract()
  const { isLoading: approveConfirming } = useWaitForTransactionReceipt({ hash: approveHash })

  // Fund job
  const { writeContract: fund, data: fundHash, isPending: fundPending } = useWriteContract()
  const { isLoading: fundConfirming, isSuccess: fundSuccess, data: fundReceipt } = useWaitForTransactionReceipt({ hash: fundHash })

  // Submit with signature
  const { writeContract: submitSig, data: submitHash, isPending: submitPending } = useWriteContract()
  const { isLoading: submitConfirming } = useWaitForTransactionReceipt({ hash: submitHash })

  // Claim refund
  const { writeContract: claimRefund, data: refundHash, isPending: refundPending } = useWriteContract()
  const { isLoading: refundConfirming, isSuccess: refundSuccess } = useWaitForTransactionReceipt({ hash: refundHash })

  // USDC balance
  const { data: usdcBal } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address!],
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  })

  const loadMenu = useCallback(() => {
    setMenuLoading(true)
    setMenuError('')
    fetch(`${GATEWAY_URL}/menu`)
      .then((r) => r.json() as Promise<{ checks: Check[] }>)
      .then((d) => {
        setChecks(d.checks ?? [])
        setStep('pick')
      })
      .catch(() => setMenuError('Could not load the menu. Try again.'))
      .finally(() => setMenuLoading(false))
  }, [])

  const selectCheck = (c: Check) => {
    setSelected(c)
    setInputValues(
      Object.fromEntries(c.inputs.map((k) => [k, String(c.example[k] ?? '')]))
    )
    setStep('inputs')
  }

  const getRequestHash = useCallback(async () => {
    if (!selected) return
    setRequestHashLoading(true)
    setError('')
    try {
      const r = await fetch(`${GATEWAY_URL}/request-hash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: selected.id, input: inputValues }),
      })
      const d = await r.json() as { requestHash?: string }
      if (!d.requestHash) throw new Error('No requestHash returned')
      setRequestHash(d.requestHash as `0x${string}`)
      setStep('approve')
    } catch (e) {
      setError(parseOnchainError(e))
    } finally {
      setRequestHashLoading(false)
    }
  }, [selected, inputValues])

  const doApprove = () => {
    if (!selected || !address) return
    setError('')
    const amount = BigInt(selected.price)
    approve(
      {
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [DELIVERED_ADDRESS, amount],
        chainId: CHAIN_ID,
      },
      {
        onSuccess: () => setStep('fund'),
        onError: (e) => setError(parseOnchainError(e)),
      }
    )
  }

  const doFund = () => {
    if (!selected || !address || !requestHash) return
    setError('')
    const amount = BigInt(selected.price)
    const expiry = BigInt(Math.floor(Date.now() / 1000) + JOB_EXPIRY_SECONDS)
    const evalAddr = (evaluator || '0x0000000000000000000000000000000000000000') as `0x${string}`
    fund(
      {
        address: DELIVERED_ADDRESS,
        abi: DELIVERED_ABI,
        functionName: 'createAndFundJob',
        args: [
          PROVIDER_ADDRESS || '0x0000000000000000000000000000000000000001',
          evalAddr,
          expiry,
          requestHash,
          amount,
        ],
        chainId: CHAIN_ID,
      },
      {
        onError: (e) => setError(parseOnchainError(e)),
      }
    )
  }

  // Extract jobId from fund receipt once confirmed
  const extractJobId = useCallback(() => {
    if (!fundReceipt || jobId !== null) return
    for (const log of fundReceipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: DELIVERED_ABI,
          eventName: 'JobCreated',
          data: log.data,
          topics: log.topics,
        })
        setJobId((decoded.args as { jobId: bigint }).jobId)
        setStep('deliver')
        return
      } catch {
        // try next log
      }
    }
  }, [fundReceipt, jobId])

  if (fundSuccess && jobId === null) extractJobId()

  const doDeliver = useCallback(async () => {
    if (!selected || jobId === null) return
    setDeliveryLoading(true)
    setDeliveryError('')
    try {
      const r = await fetch(`${GATEWAY_URL}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: String(jobId), tool: selected.id, input: inputValues }),
      })
      const d = await r.json() as DeliveryResponse
      if (!d.receipt) throw new Error(JSON.stringify(d))
      setDelivery(d)
      setStep('submit')
    } catch (e) {
      setDeliveryError(String((e as Error).message))
    } finally {
      setDeliveryLoading(false)
    }
  }, [selected, jobId, inputValues])

  const doSubmit = () => {
    if (!delivery) return
    setError('')
    const { receipt, signature } = delivery
    submitSig(
      {
        address: DELIVERED_ADDRESS,
        abi: DELIVERED_ABI,
        functionName: 'submitWithSignature',
        args: [
          BigInt(receipt.jobId),
          receipt.responseHash as `0x${string}`,
          receipt.status,
          BigInt(receipt.deliveredAt),
          signature as `0x${string}`,
        ],
        chainId: CHAIN_ID,
      },
      {
        onSuccess: () => setStep('done'),
        onError: (e) => setError(parseOnchainError(e)),
      }
    )
  }

  const doClaimRefund = () => {
    if (jobId === null) return
    setError('')
    claimRefund(
      {
        address: DELIVERED_ADDRESS,
        abi: DELIVERED_ABI,
        functionName: 'claimRefund',
        args: [jobId],
        chainId: CHAIN_ID,
      },
      { onError: (e) => setError(parseOnchainError(e)) }
    )
  }

  const reset = () => {
    setStep(isConnected ? 'pick' : 'connect')
    setSelected(null)
    setInputValues({})
    setRequestHash('0x')
    setJobId(null)
    setDelivery(null)
    setDeliveryError('')
    setError('')
  }

  const stepOrder: Step[] = ['connect', 'pick', 'inputs', 'approve', 'fund', 'deliver', 'submit', 'done']
  const stepIdx = stepOrder.indexOf(step)
  const isDone = (s: Step) => stepOrder.indexOf(s) < stepIdx

  return (
    <section className="mx-auto max-w-md px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <h2
          className="display text-2xl font-bold"
          style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}
        >
          Buy a check
        </h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Pay only when the result arrives, verified by a signed receipt.
        </p>
      </div>

      {/* Not set up notice */}
      {!PROVIDER_ADDRESS && (
        <div
          className="mb-4 flex items-start gap-2 rounded-2xl p-3"
          style={{ background: 'rgba(107,101,128,0.08)', border: '1px solid var(--border-strong)' }}
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--muted)' }} />
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Provider not set up yet. Run <span className="mono text-xs">scripts/setup-provider.ts</span> and fill in <span className="mono text-xs">PROVIDER_ADDRESS</span> in the config.
          </p>
        </div>
      )}

      {/* Wrong chain banner */}
      {wrongChain && (
        <div
          className="mb-4 flex items-center justify-between gap-3 rounded-2xl p-4"
          style={{ background: 'rgba(186,43,76,0.08)', border: '1px solid var(--danger)' }}
        >
          <span className="text-sm" style={{ color: 'var(--danger)' }}>
            Switch to Arc Testnet to continue.
          </span>
          <button
            onClick={() => switchChain({ chainId: CHAIN_ID })}
            className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold text-white"
            style={{ background: 'var(--danger)' }}
          >
            Switch
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="mb-4 flex items-start gap-2 rounded-2xl p-3"
          style={{ background: 'rgba(186,43,76,0.08)', border: '1px solid var(--danger)' }}
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--danger)' }} />
          <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
        </div>
      )}

      {/* Main card */}
      <div
        className="rounded-3xl p-5 space-y-5"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
      >

        {/* Step 1: Connect */}
        <div>
          <StepLabel n={1} label="Connect wallet" active={step === 'connect'} done={isDone('connect')} />
          {step === 'connect' && (
            <div className="mt-3">
              <ConnectKitButton.Custom>
                {({ isConnected: ic, show }) => (
                  <button
                    onClick={() => {
                      if (ic) {
                        if (!wrongChain) { loadMenu(); setStep('pick') }
                      } else {
                        show?.()
                      }
                    }}
                    className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
                    style={{ background: 'var(--accent)' }}
                  >
                    {ic ? (wrongChain ? 'Switch to Arc Testnet' : 'Load checks') : 'Connect wallet'}
                  </button>
                )}
              </ConnectKitButton.Custom>
              {isConnected && !wrongChain && (
                <button
                  onClick={() => { loadMenu(); }}
                  disabled={menuLoading}
                  className="mt-2 w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all disabled:opacity-50"
                  style={{ background: 'var(--accent)' }}
                >
                  {menuLoading ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />Loading menu…</span> : 'Load checks'}
                </button>
              )}
              {menuError && <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{menuError}</p>}
            </div>
          )}
        </div>

        {/* Step 2: Pick check */}
        {(step === 'pick' || isDone('pick')) && (
          <div>
            <StepLabel n={2} label="Pick a check" active={step === 'pick'} done={isDone('pick')} />
            {step === 'pick' && (
              <div className="mt-3 space-y-2">
                {checks.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => selectCheck(c)}
                    className="w-full text-left rounded-2xl p-4 transition-all hover:scale-[1.005]"
                    style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{c.title}</span>
                      <span className="shrink-0 tabular-nums text-sm font-bold" style={{ color: 'var(--accent)' }}>
                        ${formatUsdc(BigInt(c.price))}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>{c.about}</p>
                  </button>
                ))}
              </div>
            )}
            {isDone('pick') && selected && (
              <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                {selected.title} — <span className="tabular-nums">${formatUsdc(BigInt(selected.price))} USDC</span>
              </p>
            )}
          </div>
        )}

        {/* Step 3: Inputs */}
        {(step === 'inputs' || isDone('inputs')) && selected && (
          <div>
            <StepLabel n={3} label="Fill inputs" active={step === 'inputs'} done={isDone('inputs')} />
            {step === 'inputs' && (
              <div className="mt-3 space-y-3">
                {selected.inputs.map((k) => (
                  <div key={k}>
                    <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>{k}</label>
                    <input
                      value={inputValues[k] ?? ''}
                      onChange={(e) => setInputValues((p) => ({ ...p, [k]: e.target.value }))}
                      className="w-full rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 ring-offset-1"
                      style={{
                        background: 'var(--surface-muted)',
                        border: '1px solid var(--border)',
                        color: 'var(--ink)',
                      }}
                    />
                  </div>
                ))}
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--muted)' }}>
                    Evaluator address
                    <span className="ml-1 font-normal" style={{ color: 'var(--subtle)' }}>
                      — approves payment or sends money back
                    </span>
                  </label>
                  <input
                    value={evaluator}
                    onChange={(e) => setEvaluator(e.target.value)}
                    placeholder="0x… (leave blank for no evaluator)"
                    className="mono w-full rounded-xl px-3 py-2.5 text-xs outline-none focus:ring-2 ring-offset-1"
                    style={{
                      background: 'var(--surface-muted)',
                      border: '1px solid var(--border)',
                      color: 'var(--ink)',
                    }}
                  />
                </div>
                <button
                  onClick={() => { void getRequestHash() }}
                  disabled={requestHashLoading || selected.inputs.some((k) => !inputValues[k])}
                  className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] disabled:opacity-40"
                  style={{ background: 'var(--accent)' }}
                >
                  {requestHashLoading
                    ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />Getting hash…</span>
                    : 'Continue'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 4: Approve USDC */}
        {(step === 'approve' || isDone('approve')) && selected && (
          <div>
            <StepLabel n={4} label={`Allow $${formatUsdc(BigInt(selected.price))} USDC`} active={step === 'approve'} done={isDone('approve')} />
            {step === 'approve' && (
              <div className="mt-3 space-y-2">
                {usdcBal !== undefined && (
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    Your balance: <span className="tabular-nums">${formatUsdc(usdcBal)}</span> USDC
                  </p>
                )}
                <button
                  onClick={doApprove}
                  disabled={approvePending || approveConfirming}
                  className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] disabled:opacity-40"
                  style={{ background: 'var(--accent)' }}
                >
                  {approvePending
                    ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />Confirm in wallet…</span>
                    : approveConfirming
                    ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />Confirming…</span>
                    : 'Allow USDC'}
                </button>
                {approveHash && <TxLink hash={approveHash} />}
              </div>
            )}
          </div>
        )}

        {/* Step 5: Fund job */}
        {(step === 'fund' || isDone('fund')) && selected && (
          <div>
            <StepLabel n={5} label="Fund job" active={step === 'fund'} done={isDone('fund')} />
            {step === 'fund' && (
              <div className="mt-3 space-y-2">
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  Lock ${formatUsdc(BigInt(selected.price))} USDC in escrow. Expires in 30 min.
                </p>
                <button
                  onClick={doFund}
                  disabled={fundPending || fundConfirming}
                  className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] disabled:opacity-40"
                  style={{ background: 'var(--accent)' }}
                >
                  {fundPending
                    ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />Confirm in wallet…</span>
                    : fundConfirming
                    ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />Confirming…</span>
                    : 'Fund escrow'}
                </button>
                {fundHash && <TxLink hash={fundHash} />}
              </div>
            )}
          </div>
        )}

        {/* Step 6: Deliver */}
        {(step === 'deliver' || isDone('deliver')) && (
          <div>
            <StepLabel n={6} label="Request delivery" active={step === 'deliver'} done={isDone('deliver')} />
            {step === 'deliver' && (
              <div className="mt-3 space-y-2">
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  Job #{jobId !== null ? String(jobId) : '…'} funded. Asking the provider to deliver.
                </p>
                <button
                  onClick={() => { void doDeliver() }}
                  disabled={deliveryLoading}
                  className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] disabled:opacity-40"
                  style={{ background: 'var(--accent)' }}
                >
                  {deliveryLoading
                    ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />Delivering…</span>
                    : 'Deliver'}
                </button>
                {deliveryError && <p className="text-xs" style={{ color: 'var(--danger)' }}>{deliveryError}</p>}
              </div>
            )}
            {isDone('deliver') && delivery && (
              <div className="mt-2 space-y-2">
                {/* Result summary */}
                <div
                  className="rounded-2xl p-3"
                  style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
                >
                  <div className="text-xs font-semibold mb-1" style={{ color: delivery.delivered ? 'var(--success)' : 'var(--danger)' }}>
                    {delivery.delivered ? 'Delivered' : 'Failed'}
                  </div>
                  {/* Key fields */}
                  {Object.entries(delivery.response ?? {}).slice(0, 6).map(([k, v]) => (
                    <div key={k} className="flex items-start gap-2 text-xs">
                      <span className="shrink-0 font-medium w-28 truncate" style={{ color: 'var(--muted)' }}>{k}</span>
                      <span className="mono truncate" style={{ color: 'var(--ink)' }}>{String(v)}</span>
                    </div>
                  ))}
                  {/* Raw JSON collapsible */}
                  <button
                    onClick={() => setRawOpen((p) => !p)}
                    className="mt-2 flex items-center gap-1 text-xs"
                    style={{ color: 'var(--accent-hover)' }}
                  >
                    {rawOpen ? 'Hide raw' : 'Show raw JSON'}
                    {rawOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                  </button>
                  {rawOpen && (
                    <pre
                      className="mono mt-2 max-h-48 overflow-auto rounded-xl p-2 text-xs"
                      style={{ background: '#f5f5f8', color: 'var(--ink)' }}
                    >
                      {JSON.stringify(delivery.response, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 7: Submit receipt */}
        {(step === 'submit' || isDone('submit')) && delivery && (
          <div>
            <StepLabel n={7} label="Submit receipt on-chain" active={step === 'submit'} done={isDone('submit')} />
            {step === 'submit' && (
              <div className="mt-3 space-y-2">
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  The provider's signed receipt records the delivery on-chain.
                </p>
                <button
                  onClick={doSubmit}
                  disabled={submitPending || submitConfirming}
                  className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] disabled:opacity-40"
                  style={{ background: 'var(--accent)' }}
                >
                  {submitPending
                    ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />Confirm in wallet…</span>
                    : submitConfirming
                    ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />Confirming…</span>
                    : 'Submit receipt'}
                </button>
                {submitHash && <TxLink hash={submitHash} />}
                {/* Admitted failure: offer immediate refund */}
                {delivery.receipt.status === 1 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs" style={{ color: 'var(--danger)' }}>
                      The provider admitted this delivery failed. You can claim your refund now.
                    </p>
                    <button
                      onClick={doClaimRefund}
                      disabled={refundPending || refundConfirming}
                      className="w-full rounded-2xl py-3 text-sm font-semibold transition-all hover:scale-[1.01] disabled:opacity-40"
                      style={{ background: 'rgba(186,43,76,0.1)', color: 'var(--danger)', border: '1px solid var(--danger)' }}
                    >
                      {refundPending || refundConfirming
                        ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />Processing…</span>
                        : 'Take refund'}
                    </button>
                    {refundHash && <TxLink hash={refundHash} />}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Done */}
        {step === 'done' && (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <CheckCircle2 className="size-10" style={{ color: 'var(--success)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              Receipt recorded. The evaluator will review and release payment.
            </p>
            {submitHash && <TxLink hash={submitHash} />}
            {refundSuccess && (
              <p className="text-sm" style={{ color: 'var(--success)' }}>Refund sent.</p>
            )}
            {refundHash && <TxLink hash={refundHash} />}
            <button
              onClick={reset}
              className="mt-1 rounded-2xl px-5 py-2.5 text-sm font-semibold transition-all hover:scale-[1.01]"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}
            >
              Buy another
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
