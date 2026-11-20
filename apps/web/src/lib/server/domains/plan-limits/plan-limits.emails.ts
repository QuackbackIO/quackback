/**
 * The plan limits emails: one when the grace starts, one two days before it
 * ends and one once it has ended, each to everyone who manages billing.
 *
 * They are account mail, so they ignore notification preferences and are not
 * counted on the monthly email meter (`PlanLimitsEmail` is exempt in
 * `@quackback/email`'s mail classes).
 *
 * Each is sent at most once per recipient per grace. The stored state records
 * who has had each email (`emailRecipients`) and which are complete
 * (`emailsSent`), and is replaced when a new grace starts, so a restart or a
 * retry never repeats one and a new drop sends again. A send claims its
 * recipients under the row lock before any mail leaves and marks them sent
 * after; a failed recipient gives its claim back so the next hourly slot sends
 * only to those still missing, and a claim left by a crash lapses.
 */
import type { PlanLimitsEmailKind as EmailKind, PlanLimitsEmailRow } from '@quackback/email'
import type { AccountEmail } from '@quackback/email/recipient'
import { logger } from '@/lib/server/logger'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { StoredPlanLimitsState } from '@/lib/shared/db-types'
import { PLAN_LIMITS_PATH } from '@/lib/shared/billing/plan-limits-path'
import { updatePlanLimitsState } from '@/lib/server/domains/settings/settings.plan-limits'
import { PLAN_CATALOGUE } from '@/lib/server/domains/settings/cloud/cloud.types'
import { PLAN_FEATURE_LINKS } from './plan-limits.features'
import {
  parsePlanLimitsState,
  planLimitsDeadlineDay,
  type PlanLimitIssueKey,
  type PlanLimitsState,
  type PlanLimitsView,
} from './plan-limits.rules'
import type { PlanLimitsEmailKind, PlanLimitsEmailState } from './plan-limits.email-state'

const log = logger.child({ component: 'plan-limits-emails' })

const REMINDER_LEAD_MS = 2 * 24 * 60 * 60 * 1000

/** "1 status component is", "3 status components are": a count, its noun and the verb. */
function plural(n: number, noun: string): string {
  return n === 1 ? `1 ${noun} is` : `${n} ${noun}s are`
}

/** How each cap reads in the email: its name and what happens to the excess. */
const ISSUE_COPY: Record<PlanLimitIssueKey, { label: string; effect: (n: number) => string }> = {
  maxBoards: {
    label: 'Boards',
    effect: (n) => `${n} ${n === 1 ? 'board becomes' : 'boards become'} read-only`,
  },
  maxTeamSeats: {
    label: 'Team seats',
    effect: (n) =>
      `${n} ${n === 1 ? 'teammate loses' : 'teammates lose'} admin access until a seat frees up`,
  },
  maxStatusComponents: {
    label: 'Status components',
    effect: (n) => `${plural(n, 'status component')} hidden from your status page`,
  },
  maxCustomRoles: { label: 'Custom roles', effect: (n) => `${plural(n, 'custom role')} locked` },
  maxSendingDomains: {
    label: 'Sending domains',
    effect: (n) => `${plural(n, 'sending domain')} paused`,
  },
  maxHelpCenterLocales: {
    label: 'Help center languages',
    effect: (n) => `${plural(n, 'help center language')} locked`,
  },
}

/**
 * A date as it reads inline ("Nov 23") and in a heading ("Mon, Nov 23"), in
 * UTC so every reader sees the same day. The year appears only when it
 * differs from the current one. The emails name the last full day to fix
 * (`deadlineDay`), never the instant the grace ends.
 */
export function deadlineText(at: Date, now: Date): { deadline: string; deadlineHeading: string } {
  const year = at.getUTCFullYear() === now.getUTCFullYear() ? {} : { year: 'numeric' as const }
  const format = (extra: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
      ...year,
      ...extra,
    }).format(at)
  return { deadline: format({}), deadlineHeading: format({ weekday: 'short' }) }
}

/** The email due now for this state, or null when none is. */
export function dueEmailKind(view: PlanLimitsView, now: Date): PlanLimitsEmailKind | null {
  if (!view.enabled || !view.since || !view.graceEndsAt) return null
  if (view.phase === 'enforced') return 'enforced'
  if (view.phase !== 'grace') return null
  const remindAt = Date.parse(view.graceEndsAt) - REMINDER_LEAD_MS
  return now.getTime() >= remindAt ? 'reminder' : 'start'
}

/** Rows for the caps over: what is used and what happens to the excess. */
export function emailRows(view: PlanLimitsView): PlanLimitsEmailRow[] {
  return view.issues.map((issue) => {
    const copy = ISSUE_COPY[issue.key]
    const excess = Math.max(issue.used - issue.cap, 1)
    return {
      label: copy.label,
      used: issue.used,
      cap: issue.cap,
      effect: copy.effect(excess),
    }
  })
}

/** Names of the paid features that pause. */
export function pausingFeatureLabels(view: PlanLimitsView): string[] {
  return view.featureIssues
    .map((issue) => PLAN_FEATURE_LINKS[issue.key]?.label)
    .filter((label): label is string => label !== undefined)
}

/** An unfinished claim older than this is treated as lost (a crash mid-send) and taken again. */
const CLAIM_LEASE_MS = 15 * 60 * 1000

type Recipients = NonNullable<PlanLimitsState['emailRecipients']>[EmailKind]

/** Change the record of one email under the row lock; false when the grace moved on or nothing changed. */
async function updateRecord(
  since: string,
  kind: EmailKind,
  change: (
    recipients: NonNullable<Recipients>,
    complete: boolean
  ) => { recipients: NonNullable<Recipients>; complete?: boolean } | null
): Promise<boolean> {
  let changed = false
  await updatePlanLimitsState((current) => {
    const state = parsePlanLimitsState(current)
    if (!state || state.since !== since) return undefined
    const complete = state.emailsSent?.includes(kind) === true
    const next = change({ ...(state.emailRecipients?.[kind] ?? {}) }, complete)
    if (!next) return undefined
    changed = true
    const emailRecipients = { ...state.emailRecipients, [kind]: next.recipients }
    const emailsSent =
      next.complete && !complete ? [...(state.emailsSent ?? []), kind] : state.emailsSent
    return {
      ...state,
      emailRecipients,
      ...(emailsSent ? { emailsSent } : {}),
    } as unknown as StoredPlanLimitsState
  })
  return changed
}

/**
 * Take the right to send `kind` to each of `ids` for the grace that began at
 * `since`. Returns the ids this caller now holds: not yet sent, and not held by
 * a live claim of another sender. Empty when the email is complete or nothing
 * is left to send.
 */
export async function claimPlanLimitsEmail(
  kind: PlanLimitsEmailKind,
  since: string,
  ids: readonly string[],
  now: Date = new Date()
): Promise<string[]> {
  let held: string[] = []
  await updateRecord(since, kind, (recipients, complete) => {
    if (complete) return null
    held = ids.filter((id) => {
      const entry = recipients[id]
      if (!entry) return true
      return entry.status === 'claimed' && now.getTime() - Date.parse(entry.at) >= CLAIM_LEASE_MS
    })
    if (held.length === 0) {
      // Everyone has had it: the email is complete.
      return ids.every((id) => recipients[id]?.status === 'sent')
        ? { recipients, complete: true }
        : null
    }
    for (const id of held) recipients[id] = { status: 'claimed', at: now.toISOString() }
    return { recipients }
  })
  return held
}

/**
 * Record the outcome of a send: `sent` ids are done, `failed` ids give their
 * claim back so a later slot retries them. The email is complete once every
 * recipient in `all` has had it.
 */
export function settlePlanLimitsEmail(
  kind: PlanLimitsEmailKind,
  since: string,
  outcome: { sent: readonly string[]; failed: readonly string[]; all: readonly string[] },
  now: Date = new Date()
): Promise<boolean> {
  return updateRecord(since, kind, (recipients) => {
    for (const id of outcome.sent) recipients[id] = { status: 'sent', at: now.toISOString() }
    for (const id of outcome.failed) delete recipients[id]
    const complete = outcome.all.every((id) => recipients[id]?.status === 'sent')
    return { recipients, complete }
  })
}

/**
 * Send the email due for `view` to each billing manager who has not had it for
 * this grace. Returns the kind when at least one recipient was sent it now, or
 * null when nothing was due or sent.
 */
export async function sendPlanLimitsEmails(
  view: PlanLimitsView & Pick<PlanLimitsEmailState, 'emailsSent'>,
  now: Date = new Date()
): Promise<PlanLimitsEmailKind | null> {
  const kind = dueEmailKind(view, now)
  if (!kind || !view.since || !view.graceEndsAt) return null
  // The hourly slot lands here for every workspace in grace or enforced: a
  // complete email costs one cached read, no lookups and no lock.
  if (view.emailsSent?.includes(kind)) return null

  const { isEmailConfigured, sendPlanLimitsEmail } = await import('@quackback/email')
  if (!isEmailConfigured()) return null

  const { managersHolding } =
    await import('@/lib/server/domains/channel-accounts/sending-domain-notify')
  const managers = (await managersHolding(PERMISSIONS.BILLING_MANAGE)).filter((m) => m.userId)
  const { resolveAccountRecipient } = await import('@/lib/server/email/recipient')
  const recipients: { principalId: string; to: AccountEmail }[] = []
  for (const manager of managers) {
    const to = await resolveAccountRecipient(manager.userId!)
    if (to) recipients.push({ principalId: manager.principalId, to })
  }
  if (recipients.length === 0) return null

  const all = recipients.map((r) => r.principalId)
  const held = new Set(await claimPlanLimitsEmail(kind, view.since, all, now))
  if (held.size === 0) return null

  const { getWorkspaceSettings } = await import('@/lib/server/domains/settings/settings.service')
  const { getBaseUrl } = await import('@/lib/server/config')
  const base = getBaseUrl().replace(/\/$/, '')
  const workspace = await getWorkspaceSettings()
  const props = {
    kind,
    workspaceName: workspace?.settings?.name,
    planName: view.plan ? PLAN_CATALOGUE[view.plan].name : null,
    fromPlanName: view.fromPlan ? PLAN_CATALOGUE[view.fromPlan].name : null,
    ...deadlineText(
      new Date(`${view.deadlineDay ?? planLimitsDeadlineDay(view.graceEndsAt)}T12:00:00.000Z`),
      now
    ),
    rows: emailRows(view),
    pausingFeatures: pausingFeatureLabels(view),
    limitsUrl: base ? `${base}${PLAN_LIMITS_PATH}` : null,
    planUrl: base ? `${base}/admin/settings/billing` : null,
  }

  const sent: string[] = []
  const failed: string[] = []
  for (const { principalId, to } of recipients) {
    if (!held.has(principalId)) continue
    try {
      await sendPlanLimitsEmail({ to, ...props })
      sent.push(principalId)
    } catch (err) {
      failed.push(principalId)
      log.warn({ err, kind, principal_id: principalId }, 'plan limits email failed')
    }
  }
  await settlePlanLimitsEmail(kind, view.since, { sent, failed, all }, now)
  if (sent.length === 0) return null
  log.info({ kind, recipients: sent.length, failed: failed.length }, 'plan limits email sent')
  return kind
}

/** {@link sendPlanLimitsEmails} that never throws, for background triggers. */
export async function sendPlanLimitsEmailsQuietly(view: PlanLimitsView): Promise<void> {
  try {
    await sendPlanLimitsEmails(view)
  } catch (err) {
    log.warn({ err }, 'plan limits emails failed')
  }
}
