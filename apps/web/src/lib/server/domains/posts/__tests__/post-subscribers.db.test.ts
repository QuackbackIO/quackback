/**
 * Real-DB coverage for a post's subscribers (post.subscribers.ts): the list a
 * teammate sees across a merged thread, who can be added (an account who can
 * see the post), the permission each change needs, and the timeline entries.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, eq, posts, postSubscriptions, principal, user } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS, type BoardAccess } from '@/lib/shared/db-types'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
const createActivity = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/domains/activity/activity.service', () => ({ createActivity }))
const dispatch = vi.hoisted(() => ({
  dispatchPostSubscriberAdded: vi.fn(async () => undefined),
  dispatchPostSubscriberRemoved: vi.fn(async () => undefined),
}))
vi.mock('@/lib/server/events/dispatch', () => dispatch)

import {
  addPostSubscriber,
  followPost,
  listPostSubscribers,
  removePostSubscriber,
  unfollowPost,
} from '../post.subscribers'
import { subscribeToPost } from '../../subscriptions/subscription.service'
import { listInboxPosts } from '../post.inbox'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: postSubscriptions.id }).from(postSubscriptions).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const TEAM_ONLY: BoardAccess = {
  ...DEFAULT_BOARD_ACCESS,
  view: 'team',
  vote: 'team',
  comment: 'team',
  submit: 'team',
}

async function seedPerson(
  name: string,
  opts: { role?: 'admin' | 'member' | 'user'; type?: 'user' | 'anonymous' } = {}
): Promise<PrincipalId> {
  const principalId = createId('principal') as PrincipalId
  let userId: UserId | null = null
  if ((opts.type ?? 'user') === 'user') {
    userId = createId('user') as UserId
    await testDb.insert(user).values({ id: userId, name, email: `${suffix()}@example.com` })
  }
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: opts.role ?? 'user',
    type: opts.type ?? 'user',
    displayName: name,
    createdAt: new Date(),
  })
  return principalId
}

async function seedPost(author: PrincipalId, access: BoardAccess = DEFAULT_BOARD_ACCESS) {
  const [board] = await testDb
    .insert(boards)
    .values({ slug: `subs-${suffix()}`, name: 'Board', access })
    .returning()
  const [post] = await testDb
    .insert(posts)
    .values({ boardId: board.id as BoardId, title: 'Dark mode', content: '', principalId: author })
    .returning()
  return post.id as PostId
}

function teammate(principalId: PrincipalId, ...permissions: PermissionKey[]): Actor {
  return {
    principalId,
    role: 'member',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set<PermissionKey>([PERMISSIONS.POST_VIEW_PRIVATE, ...permissions]),
  }
}

describe.skipIf(!fixture.available)('post subscribers (real DB, rolled back)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    return fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('adds a customer once, lists them with why and how, and removes them', async () => {
    const agent = await seedPerson('Agent', { role: 'member' })
    const ada = await seedPerson('Ada')
    const postId = await seedPost(agent)
    const actor = teammate(agent, PERMISSIONS.POST_VOTE_ON_BEHALF)

    expect(await addPostSubscriber(postId, ada, actor, { level: 'status_only' })).toEqual({
      added: true,
    })
    expect(await addPostSubscriber(postId, ada, actor)).toEqual({ added: false })
    expect(dispatch.dispatchPostSubscriberAdded).toHaveBeenCalledTimes(1)
    expect(dispatch.dispatchPostSubscriberAdded).toHaveBeenCalledWith(
      { type: 'user', principalId: agent, displayName: 'Agent' },
      expect.objectContaining({ id: postId, title: 'Dark mode' }),
      ada,
      'added'
    )
    expect(createActivity).toHaveBeenCalledTimes(1)
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        postId,
        principalId: agent,
        type: 'subscriber.added',
        metadata: { subscriberName: 'Ada' },
      })
    )

    const [listed] = await listPostSubscribers(postId, actor)
    expect(listed).toMatchObject({
      principalId: ada,
      displayName: 'Ada',
      isTeamMember: false,
      reason: 'added',
      level: 'status_only',
      canView: true,
    })

    expect(await removePostSubscriber(postId, ada, actor)).toEqual({ removed: true })
    expect(await removePostSubscriber(postId, ada, actor)).toEqual({ removed: false })
    expect(dispatch.dispatchPostSubscriberRemoved).toHaveBeenCalledTimes(1)
    expect(dispatch.dispatchPostSubscriberRemoved).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: agent }),
      expect.objectContaining({ id: postId }),
      ada,
      'added'
    )
    expect(createActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'subscriber.removed' })
    )
    expect(await listPostSubscribers(postId, actor)).toEqual([])
  })

  it('refuses someone without an account, or who cannot see the post', async () => {
    const agent = await seedPerson('Agent', { role: 'member' })
    const lead = await seedPerson('Lead', { type: 'anonymous' })
    const customer = await seedPerson('Cleo')
    const mate = await seedPerson('Mate', { role: 'member' })
    const postId = await seedPost(agent, TEAM_ONLY)
    const actor = teammate(agent, PERMISSIONS.POST_VOTE_ON_BEHALF)

    await expect(addPostSubscriber(postId, lead, actor)).rejects.toMatchObject({
      code: 'INVALID_SUBSCRIBER',
    })
    await expect(addPostSubscriber(postId, customer, actor)).rejects.toMatchObject({
      code: 'SUBSCRIBER_CANNOT_SEE_POST',
    })
    expect(await addPostSubscriber(postId, mate, actor)).toEqual({ added: true })
  })

  it('needs post.vote_on_behalf to change anyone, and post.view_private to list them', async () => {
    const agent = await seedPerson('Agent', { role: 'member' })
    const ada = await seedPerson('Ada')
    const postId = await seedPost(agent)

    await expect(addPostSubscriber(postId, ada, teammate(agent))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(removePostSubscriber(postId, ada, teammate(agent))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    const noPrivate: Actor = { ...teammate(agent), permissions: new Set() }
    await expect(listPostSubscribers(postId, noPrivate)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('treats the thread as one: a merged source subscription counts, and removal clears both', async () => {
    const agent = await seedPerson('Agent', { role: 'member' })
    const ada = await seedPerson('Ada')
    const canonical = await seedPost(agent)
    const [source] = await testDb
      .insert(posts)
      .values({
        boardId: (await testDb.select().from(posts).where(eq(posts.id, canonical)))[0].boardId,
        title: 'Dark theme please',
        content: '',
        principalId: ada,
        canonicalPostId: canonical,
      })
      .returning()
    await subscribeToPost(ada, source.id as PostId, 'author', { level: 'status_only' })
    await subscribeToPost(ada, canonical, 'vote')
    const actor = teammate(agent, PERMISSIONS.POST_VOTE_ON_BEHALF)

    const listed = await listPostSubscribers(canonical, actor)
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ principalId: ada, reason: 'vote', level: 'all' })
    expect(await addPostSubscriber(canonical, ada, actor)).toEqual({ added: false })

    expect(await removePostSubscriber(canonical, ada, actor)).toEqual({ removed: true })
    const left = await testDb
      .select()
      .from(postSubscriptions)
      .where(eq(postSubscriptions.principalId, ada))
    expect(left).toEqual([])
  })

  it('keeps someone who lost sight of the post on the list, marked as not notified', async () => {
    const agent = await seedPerson('Agent', { role: 'member' })
    const ada = await seedPerson('Ada')
    const postId = await seedPost(agent)
    await subscribeToPost(ada, postId, 'vote')
    const [{ boardId }] = await testDb.select().from(posts).where(eq(posts.id, postId))
    await testDb.update(boards).set({ access: TEAM_ONLY }).where(eq(boards.id, boardId))

    const [listed] = await listPostSubscribers(postId, teammate(agent))
    expect(listed).toMatchObject({ principalId: ada, canView: false })
  })

  it('leaves no timeline entry when a teammate subscribes themselves', async () => {
    const agent = await seedPerson('Agent', { role: 'member' })
    const postId = await seedPost(agent)
    await addPostSubscriber(postId, agent, teammate(agent, PERMISSIONS.POST_VOTE_ON_BEHALF))
    expect(createActivity).not.toHaveBeenCalled()
  })

  it('follows and unfollows a post for yourself, only one you can see', async () => {
    const ada = await seedPerson('Ada')
    const open = await seedPost(ada)
    const hidden = await seedPost(ada, TEAM_ONLY)
    const me: Actor = {
      principalId: ada,
      role: 'user',
      principalType: 'user',
      segmentIds: new Set(),
    }

    expect(await followPost(open, me, { level: 'status_only' })).toEqual({ added: true })
    expect(await followPost(open, me)).toEqual({ added: false })
    expect(dispatch.dispatchPostSubscriberAdded).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: ada }),
      expect.objectContaining({ id: open }),
      ada,
      'manual'
    )
    expect(await unfollowPost(open, me)).toEqual({ removed: true })
    expect(await unfollowPost(open, me)).toEqual({ removed: false })
    await expect(followPost(hidden, me)).rejects.toMatchObject({ code: 'POST_NOT_FOUND' })
    expect(createActivity).not.toHaveBeenCalled()
  })

  it("lists the posts a teammate follows in the inbox, a merged source's follow included", async () => {
    const agent = await seedPerson('Agent', { role: 'member' })
    const ada = await seedPerson('Ada')
    const followed = await seedPost(ada)
    const viaSource = await seedPost(ada)
    const other = await seedPost(ada)
    const [{ boardId }] = await testDb.select().from(posts).where(eq(posts.id, viaSource))
    const [source] = await testDb
      .insert(posts)
      .values({
        boardId,
        title: 'Same ask',
        content: '',
        principalId: ada,
        canonicalPostId: viaSource,
      })
      .returning()
    await subscribeToPost(agent, followed, 'manual')
    await subscribeToPost(agent, source.id as PostId, 'vote')
    await subscribeToPost(ada, other, 'author')

    const { items } = await listInboxPosts({ followerId: agent, limit: 50 })
    expect(items.map((p) => p.id).sort()).toEqual([followed, viaSource].sort())
  })
})
