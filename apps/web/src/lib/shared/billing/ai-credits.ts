/** Whether Copilot can run: AI credits left this month, none on the plan, or used up. */
export type AiCreditsState = 'available' | 'none' | 'used'

/** A null cap is unlimited; a zero cap means the plan has no AI credits at all. */
export function aiCreditsState(capTokens: number | null, usedTokens: number): AiCreditsState {
  if (capTokens === null) return 'available'
  if (capTokens === 0) return 'none'
  return usedTokens < capTokens ? 'available' : 'used'
}

/**
 * The AI allowance as Home shows it: whether AI can run, and, once this
 * period's allowance is used, when it comes back (the window's end).
 */
export function aiAllowance(
  capTokens: number | null,
  usedTokens: number,
  windowEnd: Date
): { credits: AiCreditsState; resetsAt: string | null } {
  const credits = aiCreditsState(capTokens, usedTokens)
  return { credits, resetsAt: credits === 'used' ? windowEnd.toISOString() : null }
}
