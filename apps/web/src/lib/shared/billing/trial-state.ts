const DAY_MS = 24 * 60 * 60 * 1000

export function daysUntil(iso: string, now: Date = new Date()): number | null {
  const expires = Date.parse(iso)
  if (Number.isNaN(expires)) return null
  return Math.max(0, Math.ceil((expires - now.getTime()) / DAY_MS))
}

export function hasLivePaidSub(status: string | null | undefined): boolean {
  return Boolean(status && status !== 'canceled')
}

export interface TrialEndedInput {
  plan: string
  trialActive: boolean
  trialExpiresAt: string | null
  status: string | null
  now?: Date
}

/**
 * Free + past trial window + no live sub, and nobody has chosen yet: choosing
 * Free closes the trial on the control plane, which clears `trialExpiresAt`,
 * and choosing a paid plan starts a subscription.
 */
export function isTrialEnded(input: TrialEndedInput): boolean {
  if (input.trialActive) return false
  if (input.plan !== 'free') return false
  if (hasLivePaidSub(input.status)) return false
  if (!input.trialExpiresAt) return false
  const expires = Date.parse(input.trialExpiresAt)
  if (Number.isNaN(expires)) return false
  const now = (input.now ?? new Date()).getTime()
  return now >= expires
}

/**
 * How long an ended trial nobody has chosen for leaves the rest of admin open.
 * A trial that ends mid-session must not throw someone out of their work; two
 * days later, billing managers are asked to choose before anything else.
 */
export const TRIAL_CHOICE_GRACE_MS = 2 * DAY_MS

/** When billing managers must have chosen a plan, or null unless the trial ended undecided. */
export function trialChoiceDueAt(input: TrialEndedInput): Date | null {
  if (!isTrialEnded(input) || !input.trialExpiresAt) return null
  return new Date(Date.parse(input.trialExpiresAt) + TRIAL_CHOICE_GRACE_MS)
}
