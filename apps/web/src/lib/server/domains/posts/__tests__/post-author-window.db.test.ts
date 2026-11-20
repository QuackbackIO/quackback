/**
 * A customer can edit or delete their own post until the team acts on it.
 *
 * "The team acts" is one of: moving the post off the default status, a team
 * reply (a public comment from a teammate or an API key), or a merge in either
 * direction. Nothing else closes the window: not the author's own auto-vote,
 * not other customers' votes or comments, not a private team note.
 *
 * Every entry point applies the same rule: the permission reads the portal
 * menu shows (getPostPermissions, canEditPost, canDeletePost) and the writes
 * (userEditPost, softDeletePost).
 *
 * Real database, rolled back per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
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

// Embeddings run after an edit; not what this suite is about.
vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generatePostEmbedding: vi.fn().mockResolvedValue(undefined),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  eq,
  events,
  postMentions,
  postComments,
  postStatuses,
  posts,
  principal,
  user,
  postVotes,
} from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import { canDeletePost, canEditPost, getPostPermissions } from '../post.permissions'
import { softDeletePost, userEditPost } from '../post.user-actions'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: posts.canonicalPostId }).from(posts).limit(0)
  },
})

afterAll(() => fixture.close())

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPerson(role: 'admin' | 'user'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: `U-${suffix()}`, email: `${role}-${suffix()}@example.com` })
  await testDb.insert(principal).values({ id, userId, role, type: 'user', createdAt: new Date() })
  return id
}

async function statuses() {
  const [open] = await testDb
    .insert(postStatuses)
    .values({ name: 'Open', slug: `open-${suffix()}`, color: '#000', category: 'active' })
    .returning()
  const [planned] = await testDb
    .insert(postStatuses)
    .values({ name: 'Planned', slug: `planned-${suffix()}`, color: '#000', category: 'active' })
    .returning()
  // The default is the workspace's one "Open" status.
  await testDb.update(postStatuses).set({ isDefault: false })
  await testDb.update(postStatuses).set({ isDefault: true }).where(eq(postStatuses.id, open.id))
  return { open, planned }
}

/** A fresh post as the portal writes it: on the default status, auto-voted by its author. */
async function seedOwnPost() {
  const author = await seedPerson('user')
  const { open, planned } = await statuses()
  const [board] = await testDb
    .insert(boards)
    .values({ slug: `ideas-${suffix()}`, name: 'Ideas', access: DEFAULT_BOARD_ACCESS })
    .returning()
  const [post] = await testDb
    .insert(posts)
    .values({
      boardId: board.id,
      title: 'Dark mode please',
      content: 'It hurts my eyes',
      principalId: author,
      statusId: open.id,
      voteCount: 1,
    })
    .returning()
  await testDb.insert(postVotes).values({ postId: post.id, principalId: author })
  return { author, postId: post.id as PostId, board, planned }
}

const asUser = (principalId: PrincipalId) => ({ principalId, role: 'user' as const })

/** What every entry point says about the author's post. */
async function windowFor(postId: PostId, author: PrincipalId) {
  const actor = asUser(author)
  const both = await getPostPermissions(postId, actor)
  const edit = await canEditPost(postId, actor)
  const del = await canDeletePost(postId, actor)
  expect(edit.allowed).toBe(both.canEdit.allowed)
  expect(del.allowed).toBe(both.canDelete.allowed)
  return { canEdit: both.canEdit, canDelete: both.canDelete }
}

describe.skipIf(!fixture.available)('author edit and delete window', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())

  it('lets the author edit and delete a fresh post despite their own auto-vote', async () => {
    const { author, postId } = await seedOwnPost()

    const w = await windowFor(postId, author)
    expect(w.canEdit.allowed).toBe(true)
    expect(w.canDelete.allowed).toBe(true)

    const edited = await userEditPost(
      postId,
      { title: 'Dark mode, please', content: 'Still hurts' },
      asUser(author)
    )
    expect(edited.title).toBe('Dark mode, please')
    await softDeletePost(postId, asUser(author))
    const [row] = await testDb.select().from(posts).where(eq(posts.id, postId))
    expect(row.deletedAt).not.toBeNull()
  })

  it('keeps the window open through other customers votes and comments', async () => {
    const { author, postId } = await seedOwnPost()
    const other = await seedPerson('user')
    await testDb.insert(postVotes).values({ postId, principalId: other })
    await testDb.update(posts).set({ voteCount: 2 }).where(eq(posts.id, postId))
    await testDb.insert(postComments).values({ postId, principalId: other, content: 'Me too' })

    const w = await windowFor(postId, author)
    expect(w.canEdit.allowed).toBe(true)
    expect(w.canDelete.allowed).toBe(true)
  })

  it('keeps the window open through a private team note', async () => {
    const { author, postId } = await seedOwnPost()
    const teammate = await seedPerson('admin')
    await testDb.insert(postComments).values({
      postId,
      principalId: teammate,
      content: 'Internal: dupe of #12?',
      isTeamMember: true,
      isPrivate: true,
    })

    const w = await windowFor(postId, author)
    expect(w.canEdit.allowed).toBe(true)
    expect(w.canDelete.allowed).toBe(true)
  })

  it('closes once the team moves the post off the default status', async () => {
    const { author, postId, planned } = await seedOwnPost()
    await testDb.update(posts).set({ statusId: planned.id }).where(eq(posts.id, postId))

    const w = await windowFor(postId, author)
    expect(w.canEdit).toEqual({
      allowed: false,
      reason: 'Cannot edit posts that have been reviewed by the team',
    })
    expect(w.canDelete.allowed).toBe(false)
    await expect(
      userEditPost(postId, { title: 'x', content: 'y' }, asUser(author))
    ).rejects.toMatchObject({ code: 'EDIT_NOT_ALLOWED' })
    await expect(softDeletePost(postId, asUser(author))).rejects.toMatchObject({
      code: 'DELETE_NOT_ALLOWED',
    })
  })

  it('closes once the team replies', async () => {
    const { author, postId } = await seedOwnPost()
    const teammate = await seedPerson('admin')
    await testDb.insert(postComments).values({
      postId,
      principalId: teammate,
      content: 'Thanks, looking into it',
      isTeamMember: true,
    })

    const w = await windowFor(postId, author)
    expect(w.canEdit).toEqual({
      allowed: false,
      reason: 'Cannot edit posts the team has replied to',
    })
    expect(w.canDelete).toEqual({
      allowed: false,
      reason: 'Cannot delete posts the team has replied to',
    })
    await expect(
      userEditPost(postId, { title: 'x', content: 'y' }, asUser(author))
    ).rejects.toMatchObject({ code: 'EDIT_NOT_ALLOWED' })
  })

  it('closes once the post is merged into another', async () => {
    const { author, postId, board } = await seedOwnPost()
    const [canonical] = await testDb
      .insert(posts)
      .values({ boardId: board.id, title: 'Dark theme', content: 'x', principalId: author })
      .returning()
    await testDb.update(posts).set({ canonicalPostId: canonical.id }).where(eq(posts.id, postId))

    const w = await windowFor(postId, author)
    expect(w.canEdit).toEqual({ allowed: false, reason: 'Cannot edit posts that have been merged' })
    expect(w.canDelete.allowed).toBe(false)
    await expect(softDeletePost(postId, asUser(author))).rejects.toMatchObject({
      code: 'DELETE_NOT_ALLOWED',
    })
  })

  it('closes once another post is merged into it', async () => {
    const { author, postId, board } = await seedOwnPost()
    await testDb.insert(posts).values({
      boardId: board.id,
      title: 'Night mode',
      content: 'x',
      principalId: author,
      canonicalPostId: postId,
    })

    const w = await windowFor(postId, author)
    expect(w.canEdit.allowed).toBe(false)
    expect(w.canDelete.allowed).toBe(false)
  })

  it('never lets another customer edit or delete it', async () => {
    const { postId } = await seedOwnPost()
    const other = await seedPerson('user')

    const w = await windowFor(postId, other)
    expect(w.canEdit.allowed).toBe(false)
    expect(w.canDelete.allowed).toBe(false)
  })
})

describe.skipIf(!fixture.available)('an author edit is announced like a team edit', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())

  const mentionDoc = (principalId: PrincipalId) => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Ping ' },
          { type: 'mention', attrs: { id: principalId, label: 'Sam' } },
        ],
      },
    ],
  })

  async function eventsOf(type: string, postId: PostId) {
    const rows = await testDb.select().from(events).where(eq(events.type, type))
    return rows.filter((r) => JSON.stringify(r.payload).includes(postId))
  }

  it('records post.updated and the new mention for a published post', async () => {
    const { author, postId } = await seedOwnPost()
    const mentioned = await seedPerson('user')

    await userEditPost(
      postId,
      { title: 'Dark mode, please', content: 'Ping @Sam', contentJson: mentionDoc(mentioned) },
      asUser(author)
    )

    expect(await eventsOf('post.updated', postId)).toHaveLength(1)
    const mentions = await testDb.select().from(postMentions).where(eq(postMentions.postId, postId))
    expect(mentions.map((m) => m.principalId)).toEqual([mentioned])
  })

  it('stays quiet for a held post until it is approved', async () => {
    const { author, postId } = await seedOwnPost()
    await testDb.update(posts).set({ moderationState: 'pending' }).where(eq(posts.id, postId))
    const mentioned = await seedPerson('user')

    await userEditPost(
      postId,
      { title: 'Dark mode, please', content: 'Ping @Sam', contentJson: mentionDoc(mentioned) },
      asUser(author)
    )

    expect(await eventsOf('post.updated', postId)).toHaveLength(0)
    const mentions = await testDb.select().from(postMentions).where(eq(postMentions.postId, postId))
    expect(mentions).toHaveLength(0)
  })

  it('keeps the stored document in step with a markdown-only edit', async () => {
    const { author, postId } = await seedOwnPost()

    await userEditPost(postId, { title: 'Dark mode', content: 'Brand new body' }, asUser(author))

    const [row] = await testDb.select().from(posts).where(eq(posts.id, postId))
    expect(JSON.stringify(row.contentJson)).toContain('Brand new body')
    expect(row.content).toBe('Brand new body')
  })
})
