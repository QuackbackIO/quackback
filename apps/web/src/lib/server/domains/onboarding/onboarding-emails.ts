/**
 * The two setup emails: a welcome when a new workspace's owner first lands,
 * listing their goal path, and one nudge on day two if the first real result
 * has not happened. Both go only inside the launch window, never to an
 * established workspace after an upgrade, never to someone who muted email or
 * stopped setup tips, and never twice: the `onboarding_emails` row is claimed
 * before sending.
 */
import { randomUUID } from 'crypto'
import type { PrincipalId } from '@quackback/ids'
import {
  db,
  eq,
  and,
  inArray,
  isNull,
  sql,
  boards,
  principal,
  user,
  settings,
  onboardingEmails,
  notificationPreferences,
  unsubscribeTokens,
} from '@/lib/server/db'
import { getSetupState } from '@/lib/shared/db-types'
import { isLaunchWindowOpen, launchWindowFor } from '@/lib/shared/launch-window'
import { buildLaunchTasks, type LaunchStatus, type LaunchTask } from '@/lib/shared/launch-checklist'
import { realEmail } from '@/lib/shared/anonymous-email'
import { isTeamMember } from '@/lib/shared/roles'
import { resolveFeatureFlags } from '@/lib/server/domains/settings/settings.types'
import { enqueueJob } from '@/lib/server/jobs/job-queue'
import { getBaseUrl } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import { detectFirstWin } from '@/lib/server/activation-wins'
import { sendOnboardingNudgeEmail, sendOnboardingWelcomeEmail } from '@quackback/email'

const log = logger.child({ component: 'onboarding-emails' })

export const ONBOARDING_EMAIL_QUEUE = 'onboarding-email'
export const NUDGE_DELAY_MS = 48 * 60 * 60 * 1000
/** The notification-matrix key the "Stop setup tips" link turns off. */
export const ONBOARDING_TIPS_KEY = 'onboarding_tips'

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
  | 'nothing-left'

/** Queue the welcome now and the nudge for day two; the job decides at run time. */
export async function scheduleOnboardingEmails(
  ownerPrincipalId: PrincipalId,
  now = new Date()
): Promise<void> {
  for (const [kind, runAt] of [
    ['welcome', now],
    ['nudge', new Date(now.getTime() + NUDGE_DELAY_MS)],
  ] as const) {
    await enqueueJob({
      queue: ONBOARDING_EMAIL_QUEUE,
      payload: { kind, principalId: ownerPrincipalId },
      dedupeKey: `${ONBOARDING_EMAIL_QUEUE}:${kind}:${ownerPrincipalId}`,
      runAt,
      maxAttempts: 3,
    })
  }
}

interface EmailContext {
  to: string
  name: string
  workspaceName: string
  status: LaunchStatus
  tasks: LaunchTask[]
}

/** Why this email should not go out, or what it needs when it should. */
export async function onboardingEmailContext(
  kind: OnboardingEmailKind,
  principalId: PrincipalId,
  now = new Date()
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

  const sent = await db.query.onboardingEmails.findFirst({
    where: and(eq(onboardingEmails.principalId, principalId), eq(onboardingEmails.kind, kind)),
  })
  if (sent) return { ok: false, reason: 'already-sent' }

  if (kind === 'nudge') {
    if ((await detectFirstWin(setupState)).reached)
      return { ok: false, reason: 'first-result-reached' }
  }

  const status = await launchStatusFor(org, setupState)
  const tasks = buildLaunchTasks(status).filter(
    (task) => task.classification === 'prerequisite' && !task.isCompleted && !task.isSkipped
  )
  if (tasks.length === 0) return { ok: false, reason: 'nothing-left' }
  const name = (person.userName || person.displayName || '').split(' ')[0] || 'there'
  return {
    ok: true,
    context: { to, name, workspaceName: org.name, status, tasks },
  }
}

async function launchStatusFor(
  org: typeof settings.$inferSelect,
  setupState: ReturnType<typeof getSetupState>
): Promise<LaunchStatus> {
  const flags = resolveFeatureFlags(org.featureFlags)
  const [counts] = await db
    .select({
      boards: sql<number>`(select count(*)::int from ${boards} where ${isNull(boards.deletedAt)})`,
      members: sql<number>`count(*)::int`,
    })
    .from(principal)
    .where(and(eq(principal.type, 'user'), inArray(principal.role, ['admin', 'member'])))
  return {
    hasBoards: (counts?.boards ?? 0) > 0,
    memberCount: counts?.members ?? 1,
    hasBranding: Boolean(org.logoKey),
    hasWidgetInstalled: Boolean(org.widgetInstalledFirstSeenAt),
    goals: setupState?.goals,
    feedbackPrivate: setupState?.feedbackPrivate,
    taskResolutions: setupState?.taskResolutions ?? {},
    useCase: setupState?.goals?.[0] ?? setupState?.useCase ?? null,
    permissions: {
      settingsManage: true,
      boardManage: true,
      memberManage: true,
      brandingManage: true,
      integrationManage: true,
      helpCenterManage: true,
      assistantManage: true,
    },
    features: {
      supportInbox: flags.supportInbox,
      helpCenter: flags.helpCenter,
      statusPage: flags.statusPage,
      changelog: flags.changelog,
      integrations: true,
    },
  } as LaunchStatus
}

/** Where a step's link lands: its sheet when it has one, else its page. */
export function stepUrl(task: LaunchTask, base: string): string {
  const root = base.replace(/\/$/, '')
  if (task.sheet) return `${root}/admin?open=${task.sheet}`
  return `${root}${task.href ?? '/admin'}`
}

/** The test that shows the primary goal working, as a link. */
export function testLink(
  status: LaunchStatus,
  base: string
): { label: string; url: string } | null {
  const root = base.replace(/\/$/, '')
  const primary = status.goals?.[0] ?? status.useCase
  if (primary === 'customer_support' && status.features?.supportInbox) {
    return { label: 'Send a test message', url: `${root}/admin?try=message` }
  }
  if (primary === 'product_feedback' || primary === 'internal') {
    return { label: 'Post a test idea', url: `${root}/admin?try=idea` }
  }
  return null
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
  now = new Date()
): Promise<{ sent: true } | { sent: false; reason: OnboardingEmailSkip }> {
  const result = await onboardingEmailContext(kind, principalId, now)
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
  if (kind === 'welcome') {
    await sendOnboardingWelcomeEmail({
      to: context.to,
      name: context.name,
      workspaceName: context.workspaceName,
      steps: context.tasks.slice(0, 3).map((task) => ({
        title: task.title,
        outcome: task.description,
        url: stepUrl(task, base),
      })),
      homeUrl: `${base.replace(/\/$/, '')}/admin`,
      unsubscribeUrl: unsubscribe,
    })
  } else {
    const next = context.tasks[0]
    await sendOnboardingNudgeEmail({
      to: context.to,
      name: context.name,
      workspaceName: context.workspaceName,
      nextStep: { title: next.title, url: stepUrl(next, base) },
      test: testLink(context.status, base),
      unsubscribeUrl: unsubscribe,
    })
  }
}

/** The job: one email, decided when it runs rather than when it was queued. */
export async function runOnboardingEmailJob(job: {
  payload: Record<string, unknown>
}): Promise<void> {
  const kind = job.payload.kind
  const principalId = job.payload.principalId
  if ((kind !== 'welcome' && kind !== 'nudge') || typeof principalId !== 'string') return
  await sendOnboardingEmail(kind, principalId as PrincipalId)
}
