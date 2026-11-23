/**
 * Setup-tip unsubscribe tokens against a real database: opening the link only
 * reads the token (mail scanners and link previews open every link), and
 * spending it turns setup tips off once.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  boards,
  eq,
  notificationPreferences,
  posts,
  postSubscriptions,
  principal,
  unsubscribeTokens,
  user,
} from '@/lib/server/db'
import { ONBOARDING_TIPS_KEY } from '@/lib/shared/onboarding-tips'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  previewUnsubscribeToken,
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

  it('previewing names the action and changes nothing', async () => {
    const token = await mintToken()

    expect(await previewUnsubscribeToken(token)).toMatchObject({ action: 'unsubscribe_onboarding' })
    expect(await previewUnsubscribeToken(token)).toMatchObject({ action: 'unsubscribe_onboarding' })

    expect(await usedAt(token)).toBeNull()
    expect(await tipsEmail()).toBeUndefined()
  })

  it('previewing an expired, used or unknown token answers null', async () => {
    const expired = await mintToken({ expiresAt: new Date(Date.now() - 1000) })
    const used = await mintToken()
    await processUnsubscribeToken(used)

    expect(await previewUnsubscribeToken(expired)).toBeNull()
    expect(await previewUnsubscribeToken(used)).toBeNull()
    expect(await previewUnsubscribeToken(crypto.randomUUID())).toBeNull()
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

  it('an expired token is never spent', async () => {
    const token = await mintToken({ expiresAt: new Date(Date.now() - 1000) })

    expect(await processUnsubscribeToken(token)).toBeNull()
    expect(await tipsEmail()).toBeUndefined()
  })

  it('a mute link stops every notification about that post for that person', async () => {
    const [board] = await testDb
      .insert(boards)
      .values({ name: 'Ideas', slug: `ideas-${createId('board').slice(-6)}` })
      .returning()
    const [post] = await testDb
      .insert(posts)
      .values({ boardId: board.id, principalId: owner, title: 'Dark mode', content: '' })
      .returning()
    await testDb
      .insert(postSubscriptions)
      .values({ postId: post.id, principalId: owner, reason: 'vote' })
    const token = crypto.randomUUID()
    await testDb.insert(unsubscribeTokens).values({
      token,
      principalId: owner,
      postId: post.id as PostId,
      action: 'mute_post',
      expiresAt: new Date(Date.now() + 86_400_000),
    })

    expect(await processUnsubscribeToken(token)).toMatchObject({ action: 'mute_post' })

    const { getSubscribersForEvent } =
      await import('@/lib/server/domains/subscriptions/subscription.service')
    expect(await getSubscribersForEvent(post.id as PostId, 'comment')).toEqual([])
    expect(await getSubscribersForEvent(post.id as PostId, 'status_change')).toEqual([])
    const rows = await testDb
      .select()
      .from(postSubscriptions)
      .where(and(eq(postSubscriptions.postId, post.id), eq(postSubscriptions.principalId, owner)))
    expect(rows).toEqual([])
    expect(await usedAt(token)).toBeInstanceOf(Date)
  })
})
