// Canonical type lives in lib/server/domains/settings/tier-limits.types.ts.
// import type is safe here — type-only imports are erased at runtime and
// cannot pull server modules into the client bundle.
import type { PlanNotice } from '@/lib/server/domains/settings/tier-limits.types'

export interface PlanNoticeView {
  label: string
  message?: string
  /** Whole days until expiry (ceil), clamped to >= 0. Null when the
   *  notice has no (valid) expiresAt. */
  daysLeft: number | null
  /** True at 3 days or fewer remaining — banner shifts to amber. */
  urgent: boolean
  actionUrl?: string
  actionLabel?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

export function presentPlanNotice(
  notice: PlanNotice | null | undefined,
  now: Date = new Date()
): PlanNoticeView | null {
  if (!notice) return null
  let daysLeft: number | null = null
  if (notice.expiresAt) {
    const expires = Date.parse(notice.expiresAt)
    if (!Number.isNaN(expires)) {
      daysLeft = Math.max(0, Math.ceil((expires - now.getTime()) / DAY_MS))
    }
  }
  return {
    label: notice.label,
    message: notice.message,
    daysLeft,
    urgent: daysLeft !== null && daysLeft <= 3,
    actionUrl: notice.actionUrl,
    actionLabel: notice.actionLabel,
  }
}
