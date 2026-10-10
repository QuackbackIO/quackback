// Canonical type lives in lib/server/domains/settings/tier-limits.types.ts.
// import type is safe here — type-only imports are erased at runtime and
// cannot pull server modules into the client bundle.
import type { PlanNotice } from '@/lib/server/domains/settings/tier-limits.types'

export interface PlanNoticeView {
  label: string
  trialPlan?: string
  message?: string
  /** Whole days until expiry (ceil), clamped to >= 0. Null when the
   *  notice has no (valid) expiresAt. */
  daysLeft: number | null
  /** True at 3 days or fewer remaining — banner shifts to amber. */
  urgent: boolean
  actionUrl?: string
  actionLabel?: string
  ended: boolean
  /** An ended trial's deadline for choosing a plan, while it is still ahead. */
  choiceDueAt: Date | null
}

const DAY_MS = 24 * 60 * 60 * 1000

function futureDate(iso: string | undefined, now: Date): Date | null {
  if (!iso) return null
  const at = Date.parse(iso)
  return Number.isNaN(at) || at <= now.getTime() ? null : new Date(at)
}

export function presentPlanNotice(
  notice: PlanNotice | null | undefined,
  now: Date = new Date()
): PlanNoticeView | null {
  if (!notice) return null
  let daysLeft: number | null = null
  if (notice.expiresAt) {
    const expires = Date.parse(notice.expiresAt)
    if (!Number.isNaN(expires)) {
      // Compare the raw instant first. Math.ceil of a negative fraction
      // (expired less than a day ago) rounds to 0, which used to keep the
      // banner as "ends today". Persistent trial-ended strips set `ended`.
      if (expires <= now.getTime() && !notice.ended) return null
      daysLeft = Math.max(0, Math.ceil((expires - now.getTime()) / DAY_MS))
    }
  }
  return {
    label: notice.label,
    ...(notice.trialPlan ? { trialPlan: notice.trialPlan } : {}),
    message: notice.message,
    daysLeft,
    urgent: daysLeft !== null && daysLeft <= 3,
    actionUrl: notice.actionUrl,
    actionLabel: notice.actionLabel,
    ended: Boolean(notice.ended),
    choiceDueAt: futureDate(notice.choiceDueAt, now),
  }
}

/**
 * A running trial with more than three days left. It stays out of the banner
 * and shows quietly in the sidebar until its last days.
 */
export function isQuietTrial(view: PlanNoticeView | null): boolean {
  return Boolean(view && !view.ended && view.daysLeft !== null && view.daysLeft > 3)
}
