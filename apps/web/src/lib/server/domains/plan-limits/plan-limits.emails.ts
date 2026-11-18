/**
 * The plan limits emails: one when the grace starts, one two days before it
 * ends and one once it has ended, each to everyone who manages billing.
 *
 * They are account mail, so they ignore notification preferences and are not
 * counted on the monthly email meter (`PlanLimitsEmail` is exempt in
 * `@quackback/email`'s mail classes).
 *
 * Each is sent at most once per grace. The stored state records which went
 * out (`emailsSent`) and is replaced when a new grace starts, so a restart or
 * a retry never repeats one and a new drop sends again. A send claims its
 * kind under the row lock before any mail leaves; when every recipient fails
 * the claim is released, so the next hourly slot tries again.
 */
import type { PlanLimitsEmailKind as EmailKind, PlanLimitsEmailRow } from '@quackback/email'
import type { AccountEmail } from '@quackback/email/recipient'
import { logger } from '@/lib/server/logger'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { StoredPlanLimitsState } from '@/lib/shared/db-types'
import { updatePlanLimitsState } from '@/lib/server/domains/settings/settings.plan-limits'
import { PLAN_CATALOGUE } from '@/lib/server/domains/settings/cloud/cloud.types'
import { PLAN_FEATURE_LINKS } from './plan-limits.features'
import {
  parsePlanLimitsState,
  type PlanLimitIssueKey,
  type PlanLimitsEmailKind,
  type PlanLimitsView,
} from './plan-limits.rules'

const log = logger.child({ component: 'plan-limits-emails' })

const REMINDER_LEAD_MS = 2 * 24 * 60 * 60 * 1000

/** How each cap reads in the email: its name and what happens to the excess. */
const ISSUE_COPY: Record<PlanLimitIssueKey, { label: string; one: string; many: string }> = {
  maxBoards: { label: 'Boards', one: 'becomes read-only', many: 'become read-only' },
  maxTeamSeats: { label: 'Team seats', one: 'loses admin access', many: 'lose admin access' },
  maxStatusComponents: { label: 'Status components', one: 'is hidden', many: 'are hidden' },
  maxCustomRoles: { label: 'Custom roles', one: 'is locked', many: 'are locked' },
  maxSendingDomains: { label: 'Sending domains', one: 'stops sending', many: 'stop sending' },
  maxHelpCenterLocales: { label: 'Help center languages', one: 'is locked', many: 'are locked' },
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
      effect: `${excess} ${excess === 1 ? copy.one : copy.many}`,
    }
  })
}

/** Names of the paid features that pause. */
export function pausingFeatureLabels(view: PlanLimitsView): string[] {
  return view.featureIssues
    .map((issue) => PLAN_FEATURE_LINKS[issue.key]?.label)
    .filter((label): label is string => label !== undefined)
}

async function updateEmailsSent(
  since: string,
  change: (sent: EmailKind[]) => EmailKind[] | null
): Promise<boolean> {
  let changed = false
  await updatePlanLimitsState((current) => {
    const state = parsePlanLimitsState(current)
    if (!state || state.since !== since) return undefined
    const next = change(state.emailsSent ?? [])
    if (!next) return undefined
    changed = true
    return { ...state, emailsSent: next } as unknown as StoredPlanLimitsState
  })
  return changed
}

/** Take the right to send `kind` for the grace that began at `since`. True for exactly one caller. */
export function claimPlanLimitsEmail(kind: PlanLimitsEmailKind, since: string): Promise<boolean> {
  return updateEmailsSent(since, (sent) => (sent.includes(kind) ? null : [...sent, kind]))
}

/** Give back a claim whose emails all failed, so a later slot sends it. */
export function releasePlanLimitsEmail(kind: PlanLimitsEmailKind, since: string): Promise<boolean> {
  return updateEmailsSent(since, (sent) =>
    sent.includes(kind) ? sent.filter((k) => k !== kind) : null
  )
}

/**
 * Send the email due for `view`, if it has not gone out for this grace.
 * Returns the kind sent, or null when nothing was due or sent.
 */
export async function sendPlanLimitsEmails(
  view: PlanLimitsView,
  now: Date = new Date()
): Promise<PlanLimitsEmailKind | null> {
  const kind = dueEmailKind(view, now)
  if (!kind || !view.since || !view.graceEndsAt) return null

  const { isEmailConfigured, sendPlanLimitsEmail } = await import('@quackback/email')
  if (!isEmailConfigured()) return null

  const { managersHolding, formatDeadline } =
    await import('@/lib/server/domains/channel-accounts/sending-domain-notify')
  const managers = (await managersHolding(PERMISSIONS.BILLING_MANAGE)).filter((m) => m.userId)
  const { resolveAccountRecipient } = await import('@/lib/server/email/recipient')
  const recipients: { principalId: string; to: AccountEmail }[] = []
  for (const manager of managers) {
    const to = await resolveAccountRecipient(manager.userId!)
    if (to) recipients.push({ principalId: manager.principalId, to })
  }
  if (recipients.length === 0) return null

  if (!(await claimPlanLimitsEmail(kind, view.since))) return null

  const { getWorkspaceSettings } = await import('@/lib/server/domains/settings/settings.service')
  const { getBaseUrl } = await import('@/lib/server/config')
  const base = getBaseUrl().replace(/\/$/, '')
  const workspace = await getWorkspaceSettings()
  const props = {
    kind,
    workspaceName: workspace?.settings?.name,
    planName: view.plan ? PLAN_CATALOGUE[view.plan].name : null,
    fromPlanName: view.fromPlan ? PLAN_CATALOGUE[view.fromPlan].name : null,
    graceEnds: formatDeadline(new Date(view.graceEndsAt)),
    rows: emailRows(view),
    pausingFeatures: pausingFeatureLabels(view),
    limitsUrl: base ? `${base}/admin/settings/billing/limits` : null,
    planUrl: base ? `${base}/admin/settings/billing` : null,
  }

  let sent = 0
  for (const { principalId, to } of recipients) {
    try {
      await sendPlanLimitsEmail({ to, ...props })
      sent += 1
    } catch (err) {
      log.warn({ err, kind, principal_id: principalId }, 'plan limits email failed')
    }
  }
  if (sent === 0) {
    await releasePlanLimitsEmail(kind, view.since)
    return null
  }
  log.info({ kind, recipients: sent }, 'plan limits email sent')
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
