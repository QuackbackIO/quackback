/**
 * Real-DB coverage for the email unsubscribe link.
 *
 * Mail scanners prefetch every link in a message, so opening /unsubscribe must
 * change nothing: the page asks first, and only the confirm button (a POST) or
 * a mail client's RFC 8058 one-click POST to the same URL unsubscribes. A
 * second POST with a spent token is harmless and answers 200 either way.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  boards,
  changelogSubscriptions,
  eq,
  postSubscriptions,
  posts,
  principal,
  unsubscribeTokens,
  user,
} from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// Outside the Start compiler a server function never reaches its handler, so
// this runs the handler in-process, validator included.
vi.mock('@tanstack/react-start', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start')>()),
  createServerFn: () => {
    let validate = (data: unknown) => data
    const chain: Record<string, unknown> = {}
    chain.validator = (schema: { parse: (data: unknown) => unknown }) => {
      validate = (data) => schema.parse(data)
      return chain
    }
    chain.handler =
      (handler: (args: { data: unknown }) => Promise<unknown>) => (args?: { data?: unknown }) =>
        Promise.resolve().then(() => handler({ data: validate(args?.data) }))
    return chain
  },
}))

// The page loads its catalog by reading Accept-Language off the live request,
// which a test has none of.
vi.mock('@/lib/server/functions/locale', () => ({
  loadUnsubscribeIntl: async () => ({ locale: 'en', messages: {} }),
}))

// The real changelog opt-out, with a switch to make its next call fail the
// way a dropped connection would.
const changelogFault = vi.hoisted(() => ({ next: null as Error | null }))
vi.mock('@/lib/server/domains/changelog/changelog-subscription.service', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/server/domains/changelog/changelog-subscription.service')
    >()
  return {
    ...actual,
    unsubscribeChangelog: async (principalId: PrincipalId) => {
      const fault = changelogFault.next
      changelogFault.next = null
      if (fault) throw fault
      return actual.unsubscribeChangelog(principalId)
    },
  }
})

import { Route } from '../unsubscribe'
import { processUnsubscribeTokenFn } from '@/lib/server/functions/subscriptions'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: unsubscribeTokens.id }).from(unsubscribeTokens).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

interface Seeded {
  principalId: PrincipalId
  postId: PostId
  token: string
}

async function seed(): Promise<Seeded> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Subscriber' })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: 'Subscriber',
    createdAt: new Date(),
  })
  const [board] = await testDb
    .insert(boards)
    .values({ slug: `unsub-${suffix()}`, name: 'Unsub board', access: DEFAULT_BOARD_ACCESS })
    .returning()
  const [post] = await testDb
    .insert(posts)
    .values({
      boardId: board.id as BoardId,
      title: 'Dark mode',
      content: '',
      principalId,
    })
    .returning()
  await testDb.insert(postSubscriptions).values({ postId: post.id, principalId, reason: 'vote' })
  const token = crypto.randomUUID()
  await testDb.insert(unsubscribeTokens).values({
    token,
    principalId,
    postId: post.id,
    action: 'unsubscribe_post',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })
  return { principalId, postId: post.id as PostId, token }
}

async function isSubscribed(s: Seeded): Promise<boolean> {
  const rows = await testDb
    .select({ id: postSubscriptions.id })
    .from(postSubscriptions)
    .where(
      and(eq(postSubscriptions.postId, s.postId), eq(postSubscriptions.principalId, s.principalId))
    )
  return rows.length > 0
}

async function tokenUsedAt(token: string): Promise<Date | null> {
  const [row] = await testDb
    .select({ usedAt: unsubscribeTokens.usedAt })
    .from(unsubscribeTokens)
    .where(eq(unsubscribeTokens.token, token))
  return row?.usedAt ?? null
}

type Handler = (ctx: { request: Request }) => Promise<Response>
const routeOptions = Route.options as unknown as {
  loader: (ctx: { deps: { token?: string } }) => Promise<unknown>
  server?: { handlers?: Record<string, Handler> }
}

function openPage(token: string) {
  return routeOptions.loader({ deps: { token } })
}

function oneClick(token: string, body = 'List-Unsubscribe=One-Click'): Promise<Response> {
  const post = routeOptions.server?.handlers?.POST
  if (!post) throw new Error('/unsubscribe has no POST handler')
  return post({
    request: new Request(`https://acme.test/unsubscribe?token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }),
  })
}

describe.skipIf(!fixture.available)('/unsubscribe (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('opening the link changes nothing and says what it would unsubscribe from', async () => {
    const s = await seed()

    const data = await openPage(s.token)

    expect(data).toMatchObject({
      status: 'confirm',
      action: 'unsubscribe_post',
      postTitle: 'Dark mode',
    })
    expect(await isSubscribed(s)).toBe(true)
    expect(await tokenUsedAt(s.token)).toBeNull()
  })

  it('confirming unsubscribes, and a second confirm is a harmless invalid result', async () => {
    const s = await seed()

    const first = await processUnsubscribeTokenFn({ data: { token: s.token } })
    expect(first).toMatchObject({
      success: true,
      action: 'unsubscribe_post',
      postTitle: 'Dark mode',
    })
    expect(await isSubscribed(s)).toBe(false)
    expect(await tokenUsedAt(s.token)).not.toBeNull()

    const second = await processUnsubscribeTokenFn({ data: { token: s.token } })
    expect(second).toEqual({ success: false, error: 'invalid' })
  })

  it('a reopened link after confirming shows the spent-link view, still without writing', async () => {
    const s = await seed()
    await processUnsubscribeTokenFn({ data: { token: s.token } })

    expect(await openPage(s.token)).toMatchObject({ status: 'error', error: 'invalid' })
  })

  it('one-click POST unsubscribes, and a repeat still answers 200', async () => {
    const s = await seed()

    const first = await oneClick(s.token)
    expect(first.status).toBe(200)
    expect(await isSubscribed(s)).toBe(false)

    // The subscriber resubscribes; a replayed one-click with the spent token
    // must not undo that.
    await testDb.insert(postSubscriptions).values({
      postId: s.postId,
      principalId: s.principalId,
      reason: 'manual',
    })
    const again = await oneClick(s.token)
    expect(again.status).toBe(200)
    expect(await isSubscribed(s)).toBe(true)
  })

  it('a POST without the one-click body is refused and changes nothing', async () => {
    const s = await seed()

    const res = await oneClick(s.token, 'something=else')

    expect(res.status).toBe(400)
    expect(await isSubscribed(s)).toBe(true)
    expect(await tokenUsedAt(s.token)).toBeNull()
  })

  it('a malformed or unknown token answers 200 without a write', async () => {
    const s = await seed()

    for (const token of [
      'not-a-token',
      // Passes a loose hex pattern but is not a UUID (version nibble 0).
      '12345678-1234-0234-8234-123456789abc',
      crypto.randomUUID(),
    ]) {
      const res = await oneClick(token)
      expect(res.status).toBe(200)
    }
    expect(await isSubscribed(s)).toBe(true)
  })

  it('a failed opt-out leaves the token live, so the retry it asks for still unsubscribes', async () => {
    const s = await seed()
    await testDb
      .insert(changelogSubscriptions)
      .values({ principalId: s.principalId, source: 'self_serve' })
    const token = crypto.randomUUID()
    await testDb.insert(unsubscribeTokens).values({
      token,
      principalId: s.principalId,
      postId: null,
      action: 'unsubscribe_changelog',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    const optedOutAt = async () => {
      const [row] = await testDb
        .select({ at: changelogSubscriptions.unsubscribedAt })
        .from(changelogSubscriptions)
        .where(eq(changelogSubscriptions.principalId, s.principalId))
      return row?.at ?? null
    }

    changelogFault.next = new Error('connection terminated')
    const failed = await oneClick(token)
    expect(failed.status).toBe(503)
    expect(await optedOutAt()).toBeNull()
    expect(await tokenUsedAt(token)).toBeNull()

    const retried = await oneClick(token)
    expect(retried.status).toBe(200)
    expect(await optedOutAt()).not.toBeNull()
    const spentAt = await tokenUsedAt(token)
    expect(spentAt).not.toBeNull()

    // Spent once: a replay neither acts again nor moves the stamp.
    expect((await oneClick(token)).status).toBe(200)
    expect(await tokenUsedAt(token)).toEqual(spentAt)
  })

  it('accepts the one-click body as multipart/form-data too', async () => {
    const s = await seed()
    const form = new FormData()
    form.set('List-Unsubscribe', 'One-Click')
    const post = routeOptions.server!.handlers!.POST
    const res = await post({
      request: new Request(`https://acme.test/unsubscribe?token=${s.token}`, {
        method: 'POST',
        body: form,
      }),
    })
    expect(res.status).toBe(200)
    expect(await isSubscribed(s)).toBe(false)
  })

  it('refuses an oversized body without reading past the cap, and changes nothing', async () => {
    const s = await seed()
    let pulled = 0
    const chunk = new TextEncoder().encode('List-Unsubscribe=One-Click&pad=' + 'x'.repeat(512))
    // A chunked body with no Content-Length that never ends on its own.
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.byteLength
        controller.enqueue(chunk)
      },
    })
    const post = routeOptions.server!.handlers!.POST
    const res = await post({
      request: new Request(`https://acme.test/unsubscribe?token=${s.token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: endless,
        duplex: 'half',
      } as RequestInit),
    })
    expect(res.status).toBe(400)
    expect(pulled).toBeLessThan(16 * 1024)
    expect(await isSubscribed(s)).toBe(true)
  })

  it('has no GET handler: a GET renders the confirm page instead of acting', () => {
    expect(routeOptions.server?.handlers?.GET).toBeUndefined()
  })
})
