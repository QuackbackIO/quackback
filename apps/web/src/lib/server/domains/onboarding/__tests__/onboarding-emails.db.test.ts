/**
 * The welcome and day-two setup emails: who gets them, when, and that nobody
 * gets either twice.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  conversationMessages,
  conversations,
  eq,
  notificationPreferences,
  onboardingEmails,
  principal,
  settings,
  sql,
  unsubscribeTokens,
  user,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/config')>()),
  getBaseUrl: () => 'https://acme.quackback.test',
}))
// No model in the test environment: Quinn's step is simply unavailable.
vi.mock('@/lib/server/domains/assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/assistant')>()),
  isAssistantConfigured: () => false,
}))
const mail = vi.hoisted(() => ({
  welcome: vi.fn(async (_params: Record<string, unknown>) => ({ sent: true })),
  nudge: vi.fn(async (_params: Record<string, unknown>) => ({ sent: true })),
}))
vi.mock('@quackback/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email')>()),
  sendOnboardingWelcomeEmail: mail.welcome,
  sendOnboardingNudgeEmail: mail.nudge,
}))

import {
  NUDGE_DELAY_MS,
  ONBOARDING_EMAIL_QUEUE,
  scheduleOnboardingEmails,
  sendOnboardingEmail,
} from '../onboarding-emails'
import { processUnsubscribeToken } from '@/lib/server/domains/subscriptions/subscription.service'

const fixture = await createDbTestFixture()
const DAY = 86_400_000
let owner: PrincipalId

function setupState(completedAt: Date, goals: string[]) {
  return JSON.stringify({
    version: 2,
    goals,
    steps: { core: true, workspace: true },
    completedAt: completedAt.toISOString(),
  })
}

async function seedWorkspace(
  opts: { createdAt?: Date; completedAt?: Date; goals?: string[] } = {}
) {
  const now = new Date()
  await testDb.delete(settings)
  await testDb.insert(settings).values({
    name: 'Acme',
    slug: `acme-${createId('workspace')}`,
    createdAt: opts.createdAt ?? now,
    setupState: setupState(opts.completedAt ?? now, opts.goals ?? ['customer_support']),
    featureFlags: JSON.stringify({ supportInbox: true }),
  })
}

describe.skipIf(!fixture.available)('setup emails (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    mail.welcome.mockClear()
    mail.nudge.mockClear()
    owner = createId('principal') as PrincipalId
    const uid = createId('user') as UserId
    await testDb.insert(user).values({ id: uid, name: 'Sam Rivera', email: `${uid}@acme.example` })
    await testDb
      .insert(principal)
      .values({ id: owner, userId: uid, role: 'admin', type: 'user', createdAt: new Date() })
    await seedWorkspace()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('sends the one ready email, naming the next step on their goal path, once', async () => {
    expect(await sendOnboardingEmail('welcome', owner)).toEqual({ sent: true })
    expect(mail.welcome).toHaveBeenCalledTimes(1)
    const params = mail.welcome.mock.calls[0][0] as {
      subject: string
      lang: string
      paragraphs: string[]
      cta: { url: string }
      unsubscribeUrl: string
    }
    expect(params.subject).toBe('Acme is ready, Sam')
    expect(params.lang).toBe('en')
    expect(params.paragraphs).toContain('Your next step: Put Messenger on your site.')
    expect(params.cta.url).toBe('https://acme.quackback.test/admin')
    expect(params.unsubscribeUrl).toMatch(/^https:\/\/acme\.quackback\.test\/unsubscribe\?token=/)

    expect(await sendOnboardingEmail('welcome', owner)).toEqual({
      sent: false,
      reason: 'already-sent',
    })
    expect(mail.welcome).toHaveBeenCalledTimes(1)
    const rows = await testDb
      .select()
      .from(onboardingEmails)
      .where(eq(onboardingEmails.principalId, owner))
    expect(rows.map((row) => row.kind)).toEqual(['welcome'])
  })

  it('never writes to an established workspace that only now records its setup', async () => {
    const now = new Date()
    await seedWorkspace({ createdAt: new Date(now.getTime() - 400 * DAY), completedAt: now })
    expect(await sendOnboardingEmail('welcome', owner)).toEqual({
      sent: false,
      reason: 'outside-launch-window',
    })
    expect(await sendOnboardingEmail('nudge', owner)).toMatchObject({ sent: false })
    expect(mail.welcome).not.toHaveBeenCalled()
    expect(mail.nudge).not.toHaveBeenCalled()
  })

  it('stays quiet after the launch window closes', async () => {
    expect(await sendOnboardingEmail('welcome', owner, new Date(Date.now() + 30 * DAY))).toEqual({
      sent: false,
      reason: 'outside-launch-window',
    })
  })

  it('respects muted email and the setup tips unsubscribe link', async () => {
    await testDb.insert(notificationPreferences).values({ principalId: owner, emailMuted: true })
    expect(await sendOnboardingEmail('welcome', owner)).toEqual({ sent: false, reason: 'muted' })
    await testDb
      .update(notificationPreferences)
      .set({ emailMuted: false })
      .where(eq(notificationPreferences.principalId, owner))

    expect(await sendOnboardingEmail('welcome', owner)).toEqual({ sent: true })
    const url = (mail.welcome.mock.calls[0][0] as { unsubscribeUrl: string }).unsubscribeUrl
    await processUnsubscribeToken(new URL(url).searchParams.get('token')!)
    expect(await sendOnboardingEmail('nudge', owner)).toEqual({ sent: false, reason: 'tips-off' })
    expect(mail.nudge).not.toHaveBeenCalled()
    const [token] = await testDb
      .select()
      .from(unsubscribeTokens)
      .where(eq(unsubscribeTokens.principalId, owner))
    expect(token.action).toBe('unsubscribe_onboarding')
  })

  it('nudges once on day two with a test link, unless the first result has happened', async () => {
    expect(await sendOnboardingEmail('nudge', owner)).toEqual({ sent: true })
    expect(mail.nudge.mock.calls[0][0]).toMatchObject({
      subject: 'Your next step in Acme',
      cta: {
        label: 'Put Messenger on your site',
        url: 'https://acme.quackback.test/admin?open=install-messenger',
      },
      secondary: {
        label: 'Send a test message',
        url: 'https://acme.quackback.test/admin?try=message',
      },
    })
    await testDb.delete(onboardingEmails)

    const visitor = createId('principal') as PrincipalId
    await testDb
      .insert(principal)
      .values({ id: visitor, role: 'user', type: 'anonymous', createdAt: new Date() })
    const [thread] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: visitor, channel: 'messenger', source: 'widget' })
      .returning()
    await testDb.insert(conversationMessages).values({
      conversationId: thread.id,
      principalId: visitor,
      senderType: 'visitor',
      content: 'Hello',
    })
    expect(await sendOnboardingEmail('nudge', owner)).toEqual({
      sent: false,
      reason: 'first-result-reached',
    })
  })

  it('is armed by the first win, not by chores: a finished checklist still nudges', async () => {
    await seedWorkspace({ goals: ['product_feedback'] })
    await testDb.insert(boards).values({ name: 'Ideas', slug: createId('board') })
    await testDb.update(settings).set({
      setupState: JSON.stringify({
        version: 2,
        goals: ['product_feedback'],
        steps: { core: true, workspace: true },
        completedAt: new Date().toISOString(),
        activationMilestones: { publicBoardLinkCopiedAt: new Date().toISOString() },
      }),
    })
    expect(await sendOnboardingEmail('nudge', owner)).toEqual({ sent: true })
    expect(mail.nudge.mock.calls[0][0]).toMatchObject({
      cta: { label: 'A customer posts an idea', url: 'https://acme.quackback.test/admin?try=idea' },
    })
  })

  it('only writes to teammates', async () => {
    await testDb.update(principal).set({ role: 'user' }).where(eq(principal.id, owner))
    expect(await sendOnboardingEmail('welcome', owner)).toEqual({
      sent: false,
      reason: 'not-a-teammate',
    })
  })

  it('queues the welcome now and the nudge for day two', async () => {
    const now = new Date()
    await scheduleOnboardingEmails(owner, now)
    const jobs = (await testDb.execute(
      sql`select payload, run_at from job_queue where queue = ${ONBOARDING_EMAIL_QUEUE} and payload->>'principalId' = ${owner} order by run_at`
    )) as unknown as { payload: { kind: string }; run_at: Date | string }[]
    expect(jobs.map((job) => job.payload.kind)).toEqual(['welcome', 'nudge'])
    expect(new Date(jobs[1].run_at).getTime() - new Date(jobs[0].run_at).getTime()).toBe(
      NUDGE_DELAY_MS
    )
  })

  it('skips what is done: with a board, the feedback ready email asks to share the link', async () => {
    await seedWorkspace({ goals: ['product_feedback', 'customer_support'] })
    await testDb.insert(boards).values({ name: 'Ideas', slug: createId('board') })
    expect(await sendOnboardingEmail('welcome', owner)).toEqual({ sent: true })
    const params = mail.welcome.mock.calls[0][0] as {
      paragraphs: string[]
      share: { url: string; text: string } | null
    }
    expect(params.paragraphs).toContain(
      'One step gets you to your first customer idea: share the link.'
    )
    expect(params.share).toMatchObject({
      url: 'https://acme.quackback.test/',
      text: 'acme.quackback.test',
    })
  })

  it('writes in the language the owner chose, else the one their browser asked for', async () => {
    expect(await sendOnboardingEmail('welcome', owner, new Date(), 'ar')).toEqual({ sent: true })
    expect(mail.welcome.mock.calls[0][0]).toMatchObject({ lang: 'ar', dir: 'rtl' })

    await testDb.delete(onboardingEmails)
    const [row] = await testDb.select().from(principal).where(eq(principal.id, owner))
    await testDb.update(user).set({ preferredLanguage: 'de' }).where(eq(user.id, row.userId!))
    expect(await sendOnboardingEmail('welcome', owner, new Date(), 'ar')).toEqual({ sent: true })
    const german = mail.welcome.mock.calls[1][0] as { lang: string; subject: string }
    expect(german.lang).toBe('de')
    expect(german.subject).not.toBe('Acme is ready, Sam')
  })

  it('carries the browser language from the first landing into the queued jobs', async () => {
    await scheduleOnboardingEmails(owner, new Date(), 'fr')
    const jobs = (await testDb.execute(
      sql`select payload from job_queue where queue = ${ONBOARDING_EMAIL_QUEUE} and payload->>'principalId' = ${owner}`
    )) as unknown as { payload: { locale?: string } }[]
    expect(jobs.map((job) => job.payload.locale)).toEqual(['fr', 'fr'])
  })
})
