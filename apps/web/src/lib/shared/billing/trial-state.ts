const DAY_MS = 24 * 60 * 60 * 1000

export function daysUntil(iso: string, now: Date = new Date()): number | null {
  const expires = Date.parse(iso)
  if (Number.isNaN(expires)) return null
  return Math.max(0, Math.ceil((expires - now.getTime()) / DAY_MS))
}

export function hasLivePaidSub(status: string | null | undefined): boolean {
  return Boolean(status && status !== 'canceled')
}

/** Free + past trial window + no live sub. Stays true until they subscribe. */
export function isTrialEnded(input: {
  plan: string
  trialActive: boolean
  trialExpiresAt: string | null
  status: string | null
  now?: Date
}): boolean {
  if (input.trialActive) return false
  if (input.plan !== 'free') return false
  if (hasLivePaidSub(input.status)) return false
  if (!input.trialExpiresAt) return false
  const expires = Date.parse(input.trialExpiresAt)
  if (Number.isNaN(expires)) return false
  const now = (input.now ?? new Date()).getTime()
  return now >= expires
}

export function trialEndedStorageKey(expiresAt: string): string {
  return `qb.trial-ended:${expiresAt}`
}
