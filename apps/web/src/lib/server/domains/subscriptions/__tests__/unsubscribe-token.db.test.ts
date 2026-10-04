/**
 * Unsubscribe tokens against a real database: opening the link only reads the
 * token (mail scanners and link previews open every link), and spending it is
 * one atomic claim, so two clicks or a click racing a one-click POST change
 * the preference once.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, notificationPreferences, principal, unsubscribeTokens, user } from '@/lib/server/db'
import { ONBOARDING_TIPS_KEY } from '@/lib/shared/onboarding-tips'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  peekUnsubscribeToken,
  processUnsubscribeToken,
} from '@/lib/server/domains/subscriptions/subscription.service'

const fixture = await createDbTestFixture()
let owner: PrincipalId

async function mintToken(opts: { expiresAt?: Date } = {}): Promise<string> {
  const token = crypto.randomUUID()
  await testDb.insert(unsubscribeTokens).values({
    token,
    principalId: owner,
    postId: null,
    action: 'unsubscribe_onboarding',
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 86_400_000),
  })
  return token
}

async function tipsEmail(): Promise<boolean | undefined> {
  const prefs = await testDb.query.notificationPreferences.findFirst({
    where: eq(notificationPreferences.principalId, owner),
  })
  return prefs?.matrix?.[ONBOARDING_TIPS_KEY]?.email
}

async function usedAt(token: string): Promise<Date | null | undefined> {
  const row = await testDb.query.unsubscribeTokens.findFirst({
    where: eq(unsubscribeTokens.token, token),
  })
  return row?.usedAt
}

describe.skipIf(!fixture.available)('unsubscribe tokens (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    owner = createId('principal') as PrincipalId
    const uid = createId('user') as UserId
    await testDb.insert(user).values({ id: uid, name: 'Sam', email: `${uid}@acme.example` })
    await testDb
      .insert(principal)
      .values({ id: owner, userId: uid, role: 'admin', type: 'user', createdAt: new Date() })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('peeking names the action and changes nothing', async () => {
    const token = await mintToken()

    expect(await peekUnsubscribeToken(token)).toMatchObject({ action: 'unsubscribe_onboarding' })
    expect(await peekUnsubscribeToken(token)).toMatchObject({ action: 'unsubscribe_onboarding' })

    expect(await usedAt(token)).toBeNull()
    expect(await tipsEmail()).toBeUndefined()
  })

  it('peeking an expired, used or unknown token answers null', async () => {
    const expired = await mintToken({ expiresAt: new Date(Date.now() - 1000) })
    const used = await mintToken()
    await processUnsubscribeToken(used)

    expect(await peekUnsubscribeToken(expired)).toBeNull()
    expect(await peekUnsubscribeToken(used)).toBeNull()
    expect(await peekUnsubscribeToken(crypto.randomUUID())).toBeNull()
  })

  it('spending performs the action once', async () => {
    const token = await mintToken()

    expect(await processUnsubscribeToken(token)).toMatchObject({
      action: 'unsubscribe_onboarding',
    })
    expect(await tipsEmail()).toBe(false)
    expect(await usedAt(token)).toBeInstanceOf(Date)
    expect(await processUnsubscribeToken(token)).toBeNull()
  })

  it('two spends racing each other: exactly one wins', async () => {
    const token = await mintToken()

    const results = await Promise.all([
      processUnsubscribeToken(token),
      processUnsubscribeToken(token),
    ])

    expect(results.filter((r) => r !== null)).toHaveLength(1)
  })

  it('an expired token is never spent', async () => {
    const token = await mintToken({ expiresAt: new Date(Date.now() - 1000) })

    expect(await processUnsubscribeToken(token)).toBeNull()
    expect(await tipsEmail()).toBeUndefined()
  })
})
