import type { BillingCatalogue } from '@/lib/server/control-plane/client'

/** Whether Copilot can run: AI credits left this month, none on the plan, or used up. */
export type AiCreditsState = 'available' | 'none' | 'used'

/** A null cap is unlimited; a zero cap means the plan has no AI credits at all. */
export function aiCreditsState(capTokens: number | null, usedTokens: number): AiCreditsState {
  if (capTokens === null) return 'available'
  if (capTokens === 0) return 'none'
  return usedTokens < capTokens ? 'available' : 'used'
}

export type CopilotCreditsOffer =
  | { kind: 'plan'; planName: string; priceCents: number; perSeat: boolean }
  | { kind: 'topUp'; priceCents: number }

/**
 * What the greyed-out composer can offer, priced from the plan catalogue the
 * workspace already receives: the cheapest plan that includes AI credits, or a
 * top-up once this month's are used. Null when there is no catalogue to price
 * from, so no price is ever made up.
 */
export function copilotCreditsOffer(
  catalogue: BillingCatalogue | null | undefined,
  state: AiCreditsState
): CopilotCreditsOffer | null {
  if (!catalogue || state === 'available') return null
  if (state === 'used') {
    const pack = catalogue.aiTopUpPackCents
    return typeof pack === 'number' && pack > 0 ? { kind: 'topUp', priceCents: pack } : null
  }
  const included = catalogue.aiIncludedCentsPerMonth ?? {}
  const plan = [...catalogue.plans]
    .sort((a, b) => a.rank - b.rank)
    .find((candidate) => (included[candidate.id] ?? 0) > 0 && candidate.priceMonthlyCents > 0)
  return plan
    ? {
        kind: 'plan',
        planName: plan.name,
        priceCents: plan.priceMonthlyCents,
        perSeat: plan.billedPer === 'seat',
      }
    : null
}
