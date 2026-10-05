/**
 * The AI allowance: which window `aiTokensPerMonth` is measured over, and
 * whether the workspace has used it up.
 *
 * Normally the window is the UTC calendar month. While a trial is running the
 * window is the trial itself, so a trial that crosses a month boundary gets one
 * allowance rather than two. The first month after a trial starts at the
 * trial's end, so tokens spent during the trial are not charged again to the
 * plan that follows it. With no commercial config the trial fields are never
 * read and the window is always the calendar month.
 */
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { getCloudConfig } from '@/lib/server/domains/settings/cloud/cloud.service'
import type { CloudConfig } from '@/lib/server/domains/settings/cloud/cloud.types'
import { aiTokensInWindow, utcMonthStart, utcNextMonthStart } from './usage-counter'

export interface AiBudgetWindow {
  kind: 'month' | 'trial'
  start: Date
  /** Exclusive. Also when a paused background job should look again. */
  end: Date
}

type TrialFields = Pick<
  CloudConfig,
  'enabled' | 'trialActive' | 'trialStartedAt' | 'trialExpiresAt'
>

function parseDate(value: string | null): Date | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms) : null
}

/** Pure: the allowance window in force at `now`. */
export function aiBudgetWindow(cloud: TrialFields, now: Date = new Date()): AiBudgetWindow {
  const monthStart = utcMonthStart(now)
  const monthEnd = utcNextMonthStart(now)
  if (!cloud.enabled) return { kind: 'month', start: monthStart, end: monthEnd }

  const trialStart = parseDate(cloud.trialStartedAt)
  const trialEnd = parseDate(cloud.trialExpiresAt)
  if (cloud.trialActive && trialStart && trialEnd && trialStart < trialEnd) {
    return { kind: 'trial', start: trialStart, end: trialEnd }
  }

  if (trialEnd && trialEnd > monthStart && trialEnd <= now) {
    return { kind: 'month', start: trialEnd, end: monthEnd }
  }
  return { kind: 'month', start: monthStart, end: monthEnd }
}

export async function currentAiBudgetWindow(now: Date = new Date()): Promise<AiBudgetWindow> {
  return aiBudgetWindow(await getCloudConfig(), now)
}

/** Tokens used in the current allowance window. */
export async function aiTokensThisWindow(now: Date = new Date()): Promise<number> {
  const window = await currentAiBudgetWindow(now)
  return aiTokensInWindow(window.start, window.end)
}

export interface AiBudgetStatus {
  /** Null = unlimited. */
  cap: number | null
  used: number
  exhausted: boolean
  window: AiBudgetWindow
}

/**
 * The allowance as of now. An unlimited plan never reads usage, so an install
 * without limits pays nothing for the check.
 */
export async function getAiBudgetStatus(now: Date = new Date()): Promise<AiBudgetStatus> {
  const limits = await getTierLimits()
  const cap = limits.aiTokensPerMonth
  const window = await currentAiBudgetWindow(now)
  if (cap === null) return { cap, used: 0, exhausted: false, window }
  const used = await aiTokensInWindow(window.start, window.end)
  return { cap, used, exhausted: used >= cap, window }
}
