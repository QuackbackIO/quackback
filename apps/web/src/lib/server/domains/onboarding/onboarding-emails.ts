/**
 * The two setup emails: the one "workspace is ready" email when a new
 * workspace's owner first lands, naming the link to share and the next step on
 * their goal path, and one nudge on day two if the first real result has not
 * happened. Both are written in the owner's language, go only inside the
 * launch window, never to an established workspace after an upgrade, never to
 * someone who muted email or stopped setup tips, and never twice: the
 * `onboarding_emails` row is claimed before sending.
 */
import { randomUUID } from 'crypto'
import type { PrincipalId } from '@quackback/ids'
import {
  db,
  eq,
  and,
  principal,
  user,
  settings,
  onboardingEmails,
  notificationPreferences,
  unsubscribeTokens,
} from '@/lib/server/db'
import { getSetupState } from '@/lib/shared/db-types'
import { isLaunchWindowOpen, launchWindowFor } from '@/lib/shared/launch-window'
import {
  launchPath,
  type LaunchPath,
  type LaunchStatus,
  type LaunchTask,
} from '@/lib/shared/launch-checklist'
import { realEmail } from '@/lib/shared/anonymous-email'
import { isTeamMember } from '@/lib/shared/roles'
import { enqueueJob } from '@/lib/server/jobs/job-queue'
import { getBaseUrl } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import { ONBOARDING_TIPS_KEY } from '@/lib/shared/onboarding-tips'
import { loadLaunchStatus } from './launch-status'
import { permissionsForLegacyRole } from '@/lib/server/policy/permissions'
import type { Role } from '@/lib/shared/roles'
import { detectFirstWin } from '@/lib/server/activation-wins'
import { getCloudConfig } from '@/lib/server/domains/settings/cloud/cloud.service'
import { PLAN_CATALOGUE } from '@/lib/server/domains/settings/cloud/cloud.types'
import { sendOnboardingNudgeEmail, sendOnboardingWelcomeEmail } from '@quackback/email'
import type { SupportedLocale } from '@/lib/shared/i18n'
import type { OnboardingOutcome } from '@/lib/shared/db-types'
import {
  nudgeEmailCopy,
  readyEmailCopy,
  recipientLocale,
  type EmailStep,
} from './onboarding-email-copy'

const log = logger.child({ component: 'onboarding-emails' })

export const ONBOARDING_EMAIL_QUEUE = 'onboarding-email'
export const NUDGE_DELAY_MS = 48 * 60 * 60 * 1000

export type OnboardingEmailKind = 'welcome' | 'nudge'

export type OnboardingEmailSkip =
  | 'no-workspace'
  | 'outside-launch-window'
  | 'not-a-teammate'
  | 'no-email'
  | 'muted'
  | 'tips-off'
  | 'already-sent'
  | 'first-result-reached'

/**
 * Queue the welcome now and the nudge for day two; the job decides at run time.
 * `locale` is the language the owner's browser asked for when they landed,
 * used when they have not chosen one of their own.
 */
export async function scheduleOnboardingEmails(
  ownerPrincipalId: PrincipalId,
  now = new Date(),
  locale?: SupportedLocale
): Promise<void> {
  for (const [kind, runAt] of [
    ['welcome', now],
    ['nudge', new Date(now.getTime() + NUDGE_DELAY_MS)],
  ] as const) {
    await enqueueJob({
      queue: ONBOARDING_EMAIL_QUEUE,
      payload: { kind, principalId: ownerPrincipalId, ...(locale ? { locale } : {}) },
      dedupeKey: `${ONBOARDING_EMAIL_QUEUE}:${kind}:${ownerPrincipalId}`,
      runAt,
      maxAttempts: 3,
    })
  }
}

interface EmailContext {
  to: string
  /** First name, or null when the person has not given one. */
  name: string | null
  /** The language the email is written in. */
  locale: SupportedLocale
  workspaceName: string
  status: LaunchStatus
  /** The launch plan's one path, the same three steps Home shows. */
  path: LaunchPath
  /** Path steps already done (the goal step once it is), in order. */
  done: LaunchTask[]
  /** Path steps still to do, the next one first. */
  tasks: LaunchTask[]
}

/** Why this email should not go out, or what it needs when it should. */
export async function onboardingEmailContext(
  kind: OnboardingEmailKind,
  principalId: PrincipalId,
  now = new Date(),
  requestLocale?: string
): Promise<{ ok: true; context: EmailContext } | { ok: false; reason: OnboardingEmailSkip }> {
  const [org] = await db.select().from(settings).limit(1)
  if (!org) return { ok: false, reason: 'no-workspace' }
  const setupState = getSetupState(org.setupState ?? null)
  const window = launchWindowFor({ setupState, workspaceCreatedAt: org.createdAt })
  if (!isLaunchWindowOpen(window, now)) return { ok: false, reason: 'outside-launch-window' }

  const [person] = await db
    .select({
      type: principal.type,
      role: principal.role,
      displayName: principal.displayName,
      email: user.email,
      userName: user.name,
      preferredLanguage: user.preferredLanguage,
      accountLocale: user.locale,
    })
    .from(principal)
    .innerJoin(user, eq(user.id, principal.userId))
    .where(eq(principal.id, principalId))
    .limit(1)
  if (!person || person.type !== 'user' || !isTeamMember(person.role)) {
    return { ok: false, reason: 'not-a-teammate' }
  }
  const to = realEmail(person.email)
  if (!to) return { ok: false, reason: 'no-email' }

  const prefs = await db.query.notificationPreferences.findFirst({
    where: eq(notificationPreferences.principalId, principalId),
  })
  if (prefs?.emailMuted) return { ok: false, reason: 'muted' }
  if (prefs?.matrix?.[ONBOARDING_TIPS_KEY]?.email === false)
    return { ok: false, reason: 'tips-off' }

  const [sent] = await db
    .select({ kind: onboardingEmails.kind })
    .from(onboardingEmails)
    .where(and(eq(onboardingEmails.principalId, principalId), eq(onboardingEmails.kind, kind)))
    .limit(1)
  if (sent) return { ok: false, reason: 'already-sent' }

  if (kind === 'nudge') {
    if ((await detectFirstWin(setupState)).reached)
      return { ok: false, reason: 'first-result-reached' }
  }

  // The plan as this teammate would see it on Home.
  const status: LaunchStatus = await loadLaunchStatus({
    principalId,
    role: person.role as Role,
    permissions: permissionsForLegacyRole(person.role as Role),
  })
  // The path as Home shows it. Only the first win closes it: a workspace that
  // has done every chore still gets the nudge toward its first customer.
  const path = launchPath(status)
  if (path.complete) return { ok: false, reason: 'first-result-reached' }
  const name = (person.userName || person.displayName || '').trim().split(/\s+/)[0] || null
  // Their own choice first, then their sign-in provider's, then their browser's.
  const locale = recipientLocale(person.preferredLanguage, person.accountLocale, requestLocale)
  return {
    ok: true,
    context: {
      to,
      name,
      locale,
      workspaceName: org.name,
      status,
      path,
      done: path.steps.filter((task) => task.isCompleted || task.isReady),
      // The next step first: the ready email and the nudge lead with it.
      tasks: [
        ...(path.next ? [path.next] : []),
        ...path.steps.filter((task) => task !== path.next && !task.isCompleted && !task.isReady),
      ],
    },
  }
}

function emailStep(task: LaunchTask, base: string, status?: LaunchStatus): EmailStep {
  return {
    id: task.id,
    variant: task.variant,
    title: task.title,
    url: stepUrl(task, base, status),
  }
}

/**
 * Where a step's link lands: its sheet when it has one, the test that shows
 * the first win, else its page (with the view it needs).
 */
export function stepUrl(task: LaunchTask, base: string, status?: LaunchStatus): string {
  const root = base.replace(/\/$/, '')
  if (task.sheet) return `${root}/admin?open=${task.sheet}`
  if (task.classification === 'first_win') {
    return (status && testLink(status, base)?.url) ?? `${root}/admin`
  }
  const search = task.search ? `?${new URLSearchParams(task.search).toString()}` : ''
  return `${root}${task.href ?? '/admin'}${search}`
}

/** The test that shows the primary goal working, as a link. */
export function testLink(
  status: LaunchStatus,
  base: string
): { kind: 'message' | 'idea'; label: string; url: string } | null {
  const root = base.replace(/\/$/, '')
  const primary = primaryGoal(status)
  if (primary === 'customer_support' && status.features?.supportInbox) {
    return { kind: 'message', label: 'Send a test message', url: `${root}/admin?try=message` }
  }
  if (primary === 'product_feedback' || primary === 'internal') {
    return { kind: 'idea', label: 'Post a test idea', url: `${root}/admin?try=idea` }
  }
  return null
}

function primaryGoal(status: LaunchStatus): OnboardingOutcome | null {
  return (status.goals?.[0] ?? status.useCase ?? null) as OnboardingOutcome | null
}

/** The running trial as the ready email states it, or null without one. */
async function runningTrial(): Promise<{ days: number; planName: string } | null> {
  const config = await getCloudConfig()
  if (!config.enabled || !config.trialActive || !config.plan) return null
  if (!config.trialStartedAt || !config.trialExpiresAt) return null
  const length = Date.parse(config.trialExpiresAt) - Date.parse(config.trialStartedAt)
  const days = Math.round(length / (24 * 60 * 60 * 1000))
  if (!Number.isFinite(days) || days <= 0) return null
  return { days, planName: PLAN_CATALOGUE[config.plan].name }
}

async function unsubscribeUrl(principalId: PrincipalId, base: string): Promise<string> {
  const token = randomUUID()
  await db.insert(unsubscribeTokens).values({
    token,
    principalId,
    postId: null,
    action: 'unsubscribe_onboarding',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  })
  return `${base.replace(/\/$/, '')}/unsubscribe?token=${token}`
}

/** Send one setup email if it is still due; returns why it did not go otherwise. */
export async function sendOnboardingEmail(
  kind: OnboardingEmailKind,
  principalId: PrincipalId,
  now = new Date(),
  requestLocale?: string
): Promise<{ sent: true } | { sent: false; reason: OnboardingEmailSkip }> {
  const result = await onboardingEmailContext(kind, principalId, now, requestLocale)
  if (!result.ok) {
    log.info({ kind, principal_id: principalId, reason: result.reason }, 'onboarding email skipped')
    return { sent: false, reason: result.reason }
  }
  // The claim is the record: a concurrent or retried job finds it and stops.
  const claimed = await db
    .insert(onboardingEmails)
    .values({ principalId, kind })
    .onConflictDoNothing()
    .returning({ kind: onboardingEmails.kind })
  if (claimed.length === 0) return { sent: false, reason: 'already-sent' }

  const { context } = result
  const base = getBaseUrl()
  const unsubscribe = await unsubscribeUrl(principalId, base)
  try {
    await deliver(kind, context, base, unsubscribe)
  } catch (error) {
    // Nothing went out: release the claim so the job's retry can send it.
    await db
      .delete(onboardingEmails)
      .where(and(eq(onboardingEmails.principalId, principalId), eq(onboardingEmails.kind, kind)))
    throw error
  }
  log.info({ kind, principal_id: principalId }, 'onboarding email sent')
  return { sent: true }
}

async function deliver(
  kind: OnboardingEmailKind,
  context: EmailContext,
  base: string,
  unsubscribe: string
): Promise<void> {
  const root = base.replace(/\/$/, '')
  const next = context.tasks[0]
  const common = {
    locale: context.locale,
    name: context.name,
    workspaceName: context.workspaceName,
    goal: primaryGoal(context.status),
    base,
  }
  if (kind === 'welcome') {
    const copy = await readyEmailCopy({
      ...common,
      nextStep: next ? emailStep(next, base, context.status) : null,
      homeUrl: `${root}/admin`,
      trial: await runningTrial(),
    })
    await sendOnboardingWelcomeEmail({
      to: context.to,
      workspaceName: context.workspaceName,
      unsubscribeUrl: unsubscribe,
      ...copy,
    })
  } else {
    const test = testLink(context.status, base)
    const copy = await nudgeEmailCopy({
      ...common,
      nextStep: emailStep(next ?? context.path.steps[1], base, context.status),
      test: test ? { kind: test.kind, url: test.url } : null,
    })
    await sendOnboardingNudgeEmail({
      to: context.to,
      workspaceName: context.workspaceName,
      unsubscribeUrl: unsubscribe,
      ...copy,
    })
  }
}

/** The job: one email, decided when it runs rather than when it was queued. */
export async function runOnboardingEmailJob(job: {
  payload: Record<string, unknown>
}): Promise<void> {
  const kind = job.payload.kind
  const principalId = job.payload.principalId
  const locale = typeof job.payload.locale === 'string' ? job.payload.locale : undefined
  if ((kind !== 'welcome' && kind !== 'nudge') || typeof principalId !== 'string') return
  await sendOnboardingEmail(kind, principalId as PrincipalId, new Date(), locale)
}
