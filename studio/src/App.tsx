import { useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { BuyCheck } from './components/BuyCheck'
import { ProviderScore } from './components/ProviderScore'
import { Ledger } from './components/Ledger'
import { HowItWorks } from './components/HowItWorks'

type Tab = 'buy' | 'providers' | 'ledger'

export default function App() {
  const [tab, setTab] = useState<Tab>('buy')

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      {/* Navbar */}
      <header
        className="sticky top-0 z-30 px-4 py-3"
        style={{
          background: 'rgba(255,255,255,0.80)',
          backdropFilter: 'blur(20px) saturate(200%)',
          WebkitBackdropFilter: 'blur(20px) saturate(200%)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          <div>
            <span
              className="display text-lg font-bold"
              style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}
            >
              Delivered
            </span>
            <span className="ml-2 hidden text-xs sm:inline" style={{ color: 'var(--muted)' }}>
              Pay only when the result arrives
            </span>
          </div>
          <ConnectKitButton />
        </div>
      </header>

      {/* Hero tagline (collapsed on small) */}
      <div
        className="mx-auto max-w-2xl px-4 pt-6 pb-2"
      >
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Agents pay for API calls only when the result arrives.
        </p>
      </div>

      {/* Tab bar */}
      <nav className="mx-auto max-w-2xl px-4 pt-2">
        <div
          className="flex gap-1 rounded-2xl p-1"
          style={{ background: 'var(--surface-muted)', display: 'inline-flex' }}
        >
          {(['buy', 'providers', 'ledger'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="rounded-xl px-4 py-1.5 text-sm font-medium capitalize transition-all"
              style={{
                background: tab === t ? 'var(--surface-strong)' : 'transparent',
                color: tab === t ? 'var(--ink)' : 'var(--muted)',
                boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {t === 'buy' ? 'Buy a check' : t === 'providers' ? 'Providers' : 'Ledger'}
            </button>
          ))}
        </div>
      </nav>

      {/* Tab content */}
      <main>
        {tab === 'buy' && (
          <>
            <BuyCheck />
            <HowItWorks />
          </>
        )}
        {tab === 'providers' && <ProviderScore />}
        {tab === 'ledger' && <Ledger />}
      </main>
    </div>
  )
}
