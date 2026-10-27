import { ShieldCheck, Zap, ClipboardCheck, Wallet } from 'lucide-react'

const steps = [
  {
    icon: Wallet,
    title: 'Fund',
    body: 'You lock USDC into a smart contract escrow. The provider cannot touch it.',
  },
  {
    icon: Zap,
    title: 'Deliver',
    body: 'The provider runs your API call and signs a receipt with the result.',
  },
  {
    icon: ClipboardCheck,
    title: 'Check',
    body: 'An independent evaluator reviews the receipt and decides whether it meets your request.',
  },
  {
    icon: ShieldCheck,
    title: 'Pay or refund',
    body: 'Approved: USDC goes to the provider. Rejected or no delivery: USDC returns to you.',
  },
]

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-2xl px-4 py-10">
      <h2
        className="display mb-6 text-xl font-semibold"
        style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}
      >
        How it works
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {steps.map((step, i) => (
          <div
            key={step.title}
            className="flex gap-3 rounded-2xl p-4"
            style={{
              background: 'var(--surface-strong)',
              border: '1px solid var(--border)',
            }}
          >
            <div
              className="flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
              style={{ background: 'var(--surface-muted)', color: 'var(--accent)' }}
            >
              {i + 1}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <step.icon className="size-3.5" style={{ color: 'var(--muted)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                  {step.title}
                </span>
              </div>
              <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                {step.body}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
