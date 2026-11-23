/**
 * A customer can edit or delete their own post until the team acts on it.
 *
 * "The team acts" is one of: moving the post off the default status, a team
 * reply (a public comment from a teammate or an API key), or a merge in either
 * direction. Other customers' votes close the delete half only, since deleting
 * would take their votes with it. Nothing else closes the window: not the
 * author's own auto-vote, not other customers' comments, not a private team note.
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

// Copying images in is where an edit can take seconds; a test can run
// something while it is "in flight".
const rehost = vi.hoisted(() => ({ during: null as null | (() => Promise<void>) }))
vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: async (json: unknown) => {
    if (rehost.during) await rehost.during()
    return json
  },
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  eq,
  events,
  postActivity,
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

  it('keeps the window open through other customers comments', async () => {
    const { author, postId } = await seedOwnPost()
    const other = await seedPerson('user')
    await testDb.insert(postComments).values({ postId, principalId: other, content: 'Me too' })

    const w = await windowFor(postId, author)
    expect(w.canEdit.allowed).toBe(true)
    expect(w.canDelete.allowed).toBe(true)
  })

  it('still lets the author edit, but not delete, once someone else votes', async () => {
    const { author, postId } = await seedOwnPost()
    const other = await seedPerson('user')
    await testDb.insert(postVotes).values({ postId, principalId: other })
    await testDb.update(posts).set({ voteCount: 2 }).where(eq(posts.id, postId))

    const w = await windowFor(postId, author)
    expect(w.canEdit.allowed).toBe(true)
    expect(w.canDelete).toEqual({
      allowed: false,
      reason: 'Cannot delete posts other people have voted on',
    })
    const edited = await userEditPost(
      postId,
      { title: 'Dark mode, please', content: 'Reworded' },
      asUser(author)
    )
    expect(edited.title).toBe('Dark mode, please')
    await expect(softDeletePost(postId, asUser(author))).rejects.toMatchObject({
      code: 'DELETE_NOT_ALLOWED',
    })
    const [row] = await testDb.select().from(posts).where(eq(posts.id, postId))
    expect(row.deletedAt).toBeNull()
  })

  it('opens delete again once the other vote is taken back', async () => {
    const { author, postId } = await seedOwnPost()
    const other = await seedPerson('user')
    await testDb.insert(postVotes).values({ postId, principalId: other })
    await testDb.delete(postVotes).where(eq(postVotes.principalId, other))

    const w = await windowFor(postId, author)
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

  it('records post.updated for a published post, but a customer mention notifies nobody', async () => {
    const { author, postId } = await seedOwnPost()
    const mentioned = await seedPerson('user')

    await userEditPost(
      postId,
      { title: 'Dark mode, please', content: 'Ping @Sam', contentJson: mentionDoc(mentioned) },
      asUser(author)
    )

    // post.updated is dispatched without waiting on it, so wait for its row.
    await expect
      .poll(async () => (await eventsOf('post.updated', postId)).length, { timeout: 15_000 })
      .toBe(1)
    // Customers get no mention picker: a mention node they send is crafted
    // and records no mention (FBP-B22, sync-post-mentions.ts).
    const mentions = await testDb.select().from(postMentions).where(eq(postMentions.postId, postId))
    expect(mentions).toEqual([])
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

  it('names the author on post.updated', async () => {
    const { author, postId } = await seedOwnPost()

    await userEditPost(postId, { title: 'Dark mode', content: 'Reworded' }, asUser(author))

    await expect
      .poll(async () => (await eventsOf('post.updated', postId)).length, { timeout: 15_000 })
      .toBe(1)
    const [updated] = await eventsOf('post.updated', postId)
    expect(updated.actorType).toBe('user')
    expect(updated.actorId).toBe(author)
  })
})

describe.skipIf(!fixture.available)('once the team acts, the window stays closed', () => {
  beforeEach(() => {
    rehost.during = null
    return fixture.begin()
  })
  afterEach(() => fixture.rollback())

  it('stays closed after the post is moved back to the default status', async () => {
    const { author, postId } = await seedOwnPost()
    const teammate = await seedPerson('admin')
    // Planned, then back to Open: the status is the default again, the log remembers.
    await testDb.insert(postActivity).values({
      postId,
      principalId: teammate,
      type: 'status.changed',
      metadata: { fromName: 'Open', toName: 'Planned' },
    })
    await testDb.insert(postActivity).values({
      postId,
      principalId: teammate,
      type: 'status.changed',
      metadata: { fromName: 'Planned', toName: 'Open' },
    })

    const w = await windowFor(postId, author)
    expect(w.canEdit).toEqual({
      allowed: false,
      reason: 'Cannot edit posts that have been reviewed by the team',
    })
    expect(w.canDelete.allowed).toBe(false)
  })

  it('stays closed after the team reply is deleted', async () => {
    const { author, postId } = await seedOwnPost()
    const teammate = await seedPerson('admin')
    await testDb.insert(postComments).values({
      postId,
      principalId: teammate,
      content: 'Thanks!',
      isTeamMember: true,
      deletedAt: new Date(),
    })

    const w = await windowFor(postId, author)
    expect(w.canEdit.allowed).toBe(false)
    expect(w.canDelete.allowed).toBe(false)
    await expect(softDeletePost(postId, asUser(author))).rejects.toMatchObject({
      code: 'DELETE_NOT_ALLOWED',
    })
  })

  it('stays closed after the post is unmerged', async () => {
    const { author, postId } = await seedOwnPost()
    const teammate = await seedPerson('admin')
    await testDb.insert(postActivity).values({
      postId,
      principalId: teammate,
      type: 'post.merged_away',
      metadata: {},
    })

    const w = await windowFor(postId, author)
    expect(w.canEdit).toEqual({ allowed: false, reason: 'Cannot edit posts that have been merged' })
  })
})

describe.skipIf(!fixture.available)('the window is checked again when the edit is written', () => {
  beforeEach(() => {
    rehost.during = null
    return fixture.begin()
  })
  afterEach(() => {
    rehost.during = null
    return fixture.rollback()
  })

  it('refuses an edit when the team acts while its images are being copied', async () => {
    const { author, postId, planned } = await seedOwnPost()
    rehost.during = async () => {
      await testDb.update(posts).set({ statusId: planned.id }).where(eq(posts.id, postId))
    }

    await expect(
      userEditPost(postId, { title: 'Sneaky', content: 'late edit' }, asUser(author))
    ).rejects.toMatchObject({ code: 'EDIT_NOT_ALLOWED' })
    const [row] = await testDb.select().from(posts).where(eq(posts.id, postId))
    expect(row.title).toBe('Dark mode please')
  })

  it('refuses an edit when the team replies while its images are being copied', async () => {
    const { author, postId } = await seedOwnPost()
    const teammate = await seedPerson('admin')
    rehost.during = async () => {
      await testDb.insert(postComments).values({
        postId,
        principalId: teammate,
        content: 'On it',
        isTeamMember: true,
      })
    }

    await expect(
      userEditPost(postId, { title: 'Sneaky', content: 'late edit' }, asUser(author))
    ).rejects.toMatchObject({ code: 'EDIT_NOT_ALLOWED' })
  })
})
