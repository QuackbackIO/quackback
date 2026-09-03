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
  ended: boolean
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
      const remaining = Math.ceil((expires - now.getTime()) / DAY_MS)
      // A dated operator notice (legacy CP "Free trial" strips, maintenance
      // windows) must disappear once the timestamp passes. Clamping to 0 made
      // every expired leftover read as "ends today" forever, including on
      // workspaces that now have a paid plan or complimentary grant.
      // Persistent trial-ended strips set `ended` and keep rendering.
      if (remaining < 0 && !notice.ended) return null
      daysLeft = Math.max(0, remaining)
    }
  }
  return {
    label: notice.label,
    message: notice.message,
    daysLeft,
    urgent: daysLeft !== null && daysLeft <= 3,
    actionUrl: notice.actionUrl,
    actionLabel: notice.actionLabel,
    ended: Boolean(notice.ended),
  }
}
