import { Amount, usdcDecimalsFor } from '@/onchain-money'
import { CHAIN_ID } from './delivered-config'

export function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function formatUsdc(raw: bigint | number | string): string {
  const n = typeof raw === 'bigint' ? raw : BigInt(String(raw))
  return Amount.fromRaw(n, usdcDecimalsFor(CHAIN_ID)).toFixed(2)
}

export function parseOnchainError(error: unknown): string {
  const msg = (error as { message?: string })?.message?.toLowerCase() ?? ''
  if (msg.includes('user rejected') || (error as { code?: number })?.code === 4001) {
    return 'Cancelled.'
  }
  if (msg.includes('insufficient') || msg.includes('exceeds balance')) {
    return 'Insufficient USDC balance. Use the faucet in the sidebar.'
  }
  if (msg.includes('reverted')) {
    const m = msg.match(/reason[: "]+([a-z0-9_]+)/i)
    return m ? `Transaction failed: ${m[1]}` : 'Transaction failed. Check your balance and approval.'
  }
  if (msg.includes('network') || msg.includes('timeout')) {
    return 'Network error. Try again.'
  }
  return 'Something went wrong. Try again.'
}

export function statusLabel(status: number): string {
  return ['Created', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired'][status] ?? 'Unknown'
}

export function statusColor(status: number): string {
  if (status === 3) return 'var(--success)'   // Completed
  if (status === 4) return 'var(--danger)'    // Rejected
  if (status === 5) return 'var(--muted)'     // Expired
  return 'var(--ink-2)'
}

export function shortHash(h: string): string {
  return `${h.slice(0, 10)}…`
}

export function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000) - ts
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
