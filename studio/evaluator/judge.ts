/**
 * Second opinion on a delivery from NVIDIA Nemotron, served by Nebius Token Factory.
 *
 * The rule checks in evaluate.ts prove the receipt is genuine: right job, right request,
 * the exact response the provider signed. They cannot tell whether that response is a
 * real answer to the request. Nemotron reads the request and the response and says
 * "pass" or "fail" with a one-sentence reason, which goes on chain as the reason hash
 * and into the evaluation record the app shows.
 *
 * Off unless NEBIUS_API_KEY is set. Any API error or unreadable answer falls back to the
 * rule checks alone, so a model outage never blocks a provider's payment.
 */

export interface JudgeConfig {
  apiKey: string
  model: string
  baseUrl: string
}

export interface Verdict {
  verdict: 'pass' | 'fail'
  reason: string
  model: string
}

export const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b'
export const DEFAULT_BASE_URL = 'https://api.tokenfactory.nebius.com/v1'

// What a useful answer contains, per check on the demo provider's menu.
const EXPECTED: Record<string, string> = {
  'smart-contract-verify': 'whether the contract source is verified, with the contract name or compiler details',
  'honeypot-detector': 'whether the token can be sold after buying (honeypot or not), with buy and sell tax figures',
  'token-holder-concentration': 'the largest holders of the token and the share of supply they hold',
  'dex-pool-liquidity': 'the pool tokens and its liquidity in USD',
  'defillama-tvl-oracle': 'the total value locked of the protocol in USD',
  'defillama-stablecoins': 'circulating supply and price of each requested stablecoin',
  'aave-lending-markets': 'supply and borrow rates for the requested asset',
  'whale-alert-transfers': 'a list of large transfers with amounts and addresses or hashes',
}

const SYSTEM = [
  'You review API deliveries for an escrow that pays a provider only when the result is useful.',
  'You get the check that was bought, its input and the JSON the provider returned.',
  'Answer "pass" when the JSON answers that check for that input, even if the answer is a negative finding',
  '(for example "not a honeypot" or "source not verified").',
  'Answer "fail" when it is empty, an error, placeholder data, about a different input, or missing the core figure.',
  'Reply with JSON only: {"verdict":"pass"|"fail","reason":"one short sentence"}',
].join(' ')

function clip(value: unknown, max = 6000): string {
  const s = JSON.stringify(value)
  return s.length > max ? `${s.slice(0, max)}…(truncated)` : s
}

export async function judgeDelivery(
  cfg: JudgeConfig,
  tool: string,
  input: Record<string, string>,
  response: Record<string, unknown>,
): Promise<Verdict | null> {
  const user = [
    `Check: ${tool}`,
    `A useful answer gives: ${EXPECTED[tool] ?? 'a direct answer to the check'}`,
    `Input: ${JSON.stringify(input)}`,
    `Response: ${clip(response)}`,
  ].join('\n')

  try {
    const r = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        max_tokens: 400,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!r.ok) {
      console.log(`[judge] Token Factory HTTP ${r.status}`)
      return null
    }
    const body = await r.json() as { choices?: { message?: { content?: string } }[] }
    const text = body.choices?.[0]?.message?.content ?? ''
    // Reasoning models may think out loud first; take the last JSON object in the answer.
    const found = text.match(/\{[^{}]*"verdict"[^{}]*\}/g)
    if (!found) return null
    const parsed = JSON.parse(found[found.length - 1]) as { verdict?: string; reason?: string }
    if (parsed.verdict !== 'pass' && parsed.verdict !== 'fail') return null
    const reason = String(parsed.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
    return { verdict: parsed.verdict, reason: reason || parsed.verdict, model: cfg.model }
  } catch (e) {
    console.log(`[judge] unavailable: ${String(e).slice(0, 120)}`)
    return null
  }
}
