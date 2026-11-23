/**
 * A post's status-change and new-comment emails reach everyone who follows it:
 * its author, voters, commenters and people who subscribed by hand. Only the
 * post's author is told it is "your feedback"; the email package words it for
 * a follower otherwise. Who wrote the post is read from the post itself, not
 * from why the subscription was made (a merged duplicate's author follows the
 * canonical post with reason 'author' but did not write it).
 *
 * Real database (rolled back per test): targets resolved by
 * getSubscriberTargets, then sent through the email hook. The email package is
 * the double: each sender records what it was asked to send.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/config')>()),
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

const sent = vi.hoisted(
  () => [] as Array<{ kind: string; to: string; isPostAuthor: boolean | undefined }>
)
vi.mock('@quackback/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@quackback/email')>()
  const record = (kind: string) => async (opts: { to: string; isPostAuthor?: boolean }) => {
    sent.push({ kind, to: opts.to, isPostAuthor: opts.isPostAuthor })
    return { sent: true }
  }
  return {
    ...actual,
    sendStatusChangeEmail: record('status'),
    sendNewCommentEmail: record('comment'),
  }
})

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, postSubscriptions, posts, principal, user } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import { getSubscriberTargets } from '@/lib/server/events/targets'
import { emailHook } from '@/lib/server/events/handlers/email'
import type { CommentCreatedEvent, PostStatusChangedEvent } from '@/lib/server/events/types'

const fixture = await createDbTestFixture()

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const CONTEXT = { workspaceName: 'Acme', portalBaseUrl: 'http://localhost:3100', logoUrl: null }

async function seedPerson(
  role: 'admin' | 'user',
  name: string
): Promise<{ id: PrincipalId; email: string }> {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  const email = `${name.toLowerCase()}-${suffix()}@example.com`
  await testDb.insert(user).values({ id: userId, name, email })
  await testDb
    .insert(principal)
    .values({ id, userId, role, type: 'user', displayName: name, createdAt: new Date() })
  return { id, email }
}

/** A post Ann wrote, followed by Ann, a voter, and someone whose subscription says 'author' but who did not write it. */
async function seedFollowedPost() {
  const ann = await seedPerson('user', 'Ann')
  const vic = await seedPerson('user', 'Vic')
  const dup = await seedPerson('user', 'Dee')
  const team = await seedPerson('admin', 'Tess')
  const [board] = await testDb
    .insert(boards)
    .values({ slug: `ideas-${suffix()}`, name: 'Ideas', access: DEFAULT_BOARD_ACCESS })
    .returning()
  const [post] = await testDb
    .insert(posts)
    .values({ boardId: board.id, title: 'Dark mode', content: 'Please', principalId: ann.id })
    .returning()
  await testDb.insert(postSubscriptions).values([
    { postId: post.id, principalId: ann.id, reason: 'author' },
    { postId: post.id, principalId: vic.id, reason: 'vote' },
    { postId: post.id, principalId: dup.id, reason: 'author' },
  ])
  const ref = { id: post.id as PostId, title: post.title, boardId: board.id, boardSlug: board.slug }
  return { ann, vic, dup, team, ref }
}

async function sendAll(event: PostStatusChangedEvent | CommentCreatedEvent) {
  const targets = await getSubscriberTargets(event, CONTEXT)
  for (const t of targets.filter((x) => x.type === 'email')) {
    await emailHook.run(event, t.target, t.config)
  }
  return Object.fromEntries(sent.map((s) => [s.to, s.isPostAuthor]))
}

describe.skipIf(!fixture.available)('feedback emails know who wrote the post', () => {
  beforeEach(fixture.begin)
  beforeEach(() => {
    sent.length = 0
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('a status change tells only the author it is their feedback', async () => {
    const { ann, vic, dup, team, ref } = await seedFollowedPost()
    const event: PostStatusChangedEvent = {
      id: createId('event'),
      type: 'post.status_changed',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', principalId: team.id, displayName: 'Tess' },
      data: { post: ref, previousStatus: 'Open', newStatus: 'Planned' },
    }

    expect(await sendAll(event)).toEqual({
      [ann.email]: true,
      [vic.email]: false,
      [dup.email]: false,
    })
  })

  it('a new comment tells only the author it is their feedback', async () => {
    const { ann, vic, dup, team, ref } = await seedFollowedPost()
    const event: CommentCreatedEvent = {
      id: createId('event'),
      type: 'comment.created',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', principalId: team.id, displayName: 'Tess' },
      data: { post: ref, comment: { id: createId('post_comment'), content: 'On it' } },
    }

    expect(await sendAll(event)).toEqual({
      [ann.email]: true,
      [vic.email]: false,
      [dup.email]: false,
    })
  })
})
