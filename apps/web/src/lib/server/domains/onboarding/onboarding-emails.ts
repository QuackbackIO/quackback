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
  LAUNCH_LIVE_STEP,
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
import {
  sendOnboardingNudgeEmail,
  sendOnboardingWelcomeEmail,
  type OnboardingEmailStep,
} from '@quackback/email'
import { launchTaskOutcome } from '@/lib/shared/launch-outcomes'

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
  const name = (person.userName || person.displayName || '').split(' ')[0] || 'there'
  return {
    ok: true,
    context: {
      to,
      name,
      workspaceName: org.name,
      status,
      path,
      done: path.steps.filter((task) => task.isCompleted || task.isReady),
      tasks: [
        ...(path.next ? [path.next] : []),
        ...path.steps.filter((task) => task !== path.next && !task.isCompleted && !task.isReady),
      ],
    },
  }
}

function emailStep(
  task: LaunchTask,
  status: LaunchStatus,
  base: string,
  done: boolean
): OnboardingEmailStep {
  return {
    title: task.title,
    outcome: launchTaskOutcome(task)?.defaultMessage?.toString() ?? '',
    url: stepUrl(task, base, status),
    done,
  }
}

/**
 * The path's three steps for an email, in order: the live page (done), the
 * goal step and the first win. The same list and count Home shows.
 */
export function emailPathSteps(
  path: LaunchPath,
  status: LaunchStatus,
  base: string
): OnboardingEmailStep[] {
  const [goalStep, win] = path.steps
  return [
    {
      title: LAUNCH_LIVE_STEP[path.goal].defaultMessage,
      outcome: '',
      url: `${base.replace(/\/$/, '')}/admin/getting-started`,
      done: true,
    },
    emailStep(goalStep, status, base, goalStep.isCompleted || goalStep.isReady),
    emailStep(win, status, base, win.isCompleted),
  ]
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
      steps: emailPathSteps(context.path, context.status, base),
      homeUrl: `${base.replace(/\/$/, '')}/admin`,
      unsubscribeUrl: unsubscribe,
    })
  } else {
    const next = context.tasks[0] ?? context.path.steps[1]
    await sendOnboardingNudgeEmail({
      to: context.to,
      name: context.name,
      workspaceName: context.workspaceName,
      nextStep: { title: next.title, url: stepUrl(next, base, context.status) },
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
