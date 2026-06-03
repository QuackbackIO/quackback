/**
 * createPost mention-dispatch wiring.
 *
 * After a post row is inserted, createPost extracts mentions from
 * contentJson and hands them to syncPostMentions. The mock harness mirrors
 * post-create-service.test.ts so we exercise the real createPost without
 * touching the database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import type { BoardId, PrincipalId, StatusId } from '@quackback/ids'

const insertedRows: Record<string, unknown[]> = { posts: [], votes: [], postTags: [] }
const subscribeToPost = vi.fn()
const syncPostMentions = vi.fn().mockResolvedValue(undefined)

// Holds the contentJson used by the updatePost test path so the db.update().returning()
// stub can echo it back as the "updated row".
let updatePostsFindFirstResult: {
  id: string
  title: string
  content: string
  contentJson: JSONContent | null
  boardId: string
  statusId: string
  principalId: string
  ownerPrincipalId: string | null
} | null = null
let updateReturningContentJson: JSONContent | null = null
let updateReturningTitle = 'Updated title'

vi.mock('@/lib/server/db', async () => {
  const { sql: realSql } = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')

  function chain(label: string) {
    const c: Record<string, unknown> = {}
    c.values = vi.fn((row: unknown) => {
      insertedRows[label] = (insertedRows[label] ?? []).concat(row)
      return c
    })
    c.returning = vi.fn(async () => {
      if (label === 'posts') {
        const inserted = insertedRows.posts.at(-1) as {
          principalId: string
          contentJson: JSONContent | null
          title: string
        }
        return [
          {
            id: 'post_new' as unknown,
            boardId: 'board_b' as unknown,
            statusId: 'status_open' as unknown,
            title: inserted.title,
            content: 'Body',
            contentJson: inserted.contentJson,
            principalId: inserted.principalId,
            voteCount: 1,
            commentCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]
      }
      return []
    })
    return c
  }

  return {
    db: {
      query: {
        boards: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'board_b',
            slug: 'feedback',
            name: 'Feedback',
            access: {
              view: 'anonymous',
              vote: 'anonymous',
              comment: 'anonymous',
              submit: 'anonymous',
              segments: { view: [], vote: [], comment: [], submit: [] },
              moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
            },
          }),
        },
        postStatuses: {
          findFirst: vi.fn().mockResolvedValue({ id: 'status_open', name: 'Open' }),
        },
        posts: {
          findFirst: vi.fn(async () => updatePostsFindFirstResult),
        },
        principal: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          insert: vi.fn((table: { __name?: string }) => {
            const label =
              table === undefined
                ? 'unknown'
                : (table.__name ?? (table as { [k: string]: unknown }).name ?? 'unknown')
            return chain(typeof label === 'string' ? label : 'posts')
          }),
          // createPost runs SELECT ... FOR UPDATE on the board inside the txn
          // to close the precheck/insert TOCTOU, then re-runs canCreatePost on
          // the locked access. Return a live row WITH access so the re-check
          // passes (anonymous board → anyone can submit).
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                for: vi.fn(async () => [
                  {
                    access: {
                      view: 'anonymous',
                      vote: 'anonymous',
                      comment: 'anonymous',
                      submit: 'anonymous',
                      segments: { view: [], vote: [], comment: [], submit: [] },
                      moderation: {
                        anonPosts: 'inherit',
                        signedPosts: 'inherit',
                        comments: 'inherit',
                      },
                    },
                  },
                ]),
              })),
            })),
          })),
        }
        return fn(tx)
      }),
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
      // Used by updatePost. Echoes back a fake "updated post" using the contentJson
      // captured from the call site via updateReturningContentJson.
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [
              {
                id: 'post_update' as unknown,
                boardId: 'board_b' as unknown,
                statusId: 'status_open' as unknown,
                title: updateReturningTitle,
                content: 'Body',
                contentJson: updateReturningContentJson,
                principalId: 'principal_author' as unknown,
                ownerPrincipalId: null,
                voteCount: 1,
                commentCount: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ]),
          })),
        })),
      })),
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    },
    boards: { id: 'board_id' },
    posts: { __name: 'posts', id: 'post_id' },
    postStatuses: { id: 'status_id' },
    postTags: { __name: 'postTags' },
    tags: { __name: 'tags', id: 'tag_id' },
    votes: { __name: 'votes' },
    principal: { id: 'principal_id' },
    eq: vi.fn(),
    and: vi.fn(),
    inArray: vi.fn(),
    isNull: vi.fn(),
    sql: realSql,
  }
})

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  subscribeToPost: (...args: unknown[]) => subscribeToPost(...args),
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchPostCreated: vi.fn(),
  dispatchPostUpdated: vi.fn(),
  dispatchPostStatusChanged: vi.fn(),
  buildEventActor: vi.fn((actor: { principalId: string }) => ({
    type: 'user',
    principalId: actor.principalId,
  })),
}))

vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  createActivity: vi.fn(),
}))

vi.mock('@/lib/server/markdown-tiptap', () => ({
  markdownToTiptapJson: vi.fn(() => ({ type: 'doc', content: [] })),
}))

vi.mock('@/lib/server/content/rehost-images', () => ({
  // Pass contentJson through unchanged so the mention nodes survive into the insert.
  rehostExternalImages: vi.fn(async (json: unknown) => json),
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(async () => ({ maxPosts: null, features: {} })),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: vi.fn(async () => ({ moderationDefault: { requireApproval: 'none' } })),
}))

vi.mock('../sync-post-mentions', () => ({
  syncPostMentions: (...args: unknown[]) => syncPostMentions(...args),
}))

const MENTIONED = 'principal_mentioned_one' as unknown as PrincipalId

function docWithMention(): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'hey ' },
          { type: 'mention', attrs: { id: MENTIONED, label: 'Jane' } },
          { type: 'text', text: ' please review' },
        ],
      },
    ],
  }
}

function docWithoutMention(): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'just a plain note' }],
      },
    ],
  }
}

describe('createPost mention dispatch', () => {
  beforeEach(() => {
    insertedRows.posts.length = 0
    insertedRows.votes.length = 0
    insertedRows.postTags.length = 0
    subscribeToPost.mockClear()
    syncPostMentions.mockClear()
  })

  it('calls syncPostMentions with the mentioned principalId when contentJson has a mention', async () => {
    const { createPost } = await import('../post.service')

    const authorPrincipal = 'principal_author' as unknown as PrincipalId
    await createPost(
      {
        boardId: 'board_b' as unknown as BoardId,
        title: 'New post',
        content: 'Body',
        contentJson: docWithMention() as unknown as import('@/lib/server/db').TiptapContent,
        statusId: 'status_open' as unknown as StatusId,
      },
      { principalId: authorPrincipal, email: 'author@example.com', displayName: 'Author' }
    )

    expect(syncPostMentions).toHaveBeenCalledTimes(1)
    const call = syncPostMentions.mock.calls[0][0]
    expect(call.postId).toBe('post_new')
    expect(call.postTitle).toBe('New post')
    expect(typeof call.postUrl).toBe('string')
    expect(call.postUrl).toContain('post_new')
    // The actual mentioned id is in the Set.
    expect(call.mentionedIds).toBeInstanceOf(Set)
    expect(Array.from(call.mentionedIds)).toEqual([MENTIONED])
    // Excerpt map contains the paragraph text for the mentioned principal.
    expect(call.excerptByPrincipalId).toBeInstanceOf(Map)
    expect(call.excerptByPrincipalId.get(MENTIONED)).toContain('please review')
    // Actor carries the author's principalId.
    expect(call.actor).toMatchObject({ principalId: authorPrincipal })
  })

  it('does NOT call syncPostMentions when contentJson has no mentions', async () => {
    const { createPost } = await import('../post.service')

    const authorPrincipal = 'principal_author' as unknown as PrincipalId
    await createPost(
      {
        boardId: 'board_b' as unknown as BoardId,
        title: 'No mentions',
        content: 'Body',
        contentJson: docWithoutMention() as unknown as import('@/lib/server/db').TiptapContent,
        statusId: 'status_open' as unknown as StatusId,
      },
      { principalId: authorPrincipal }
    )

    expect(syncPostMentions).not.toHaveBeenCalled()
  })
})

describe('updatePost mention dispatch', () => {
  beforeEach(() => {
    syncPostMentions.mockClear()
    updatePostsFindFirstResult = {
      id: 'post_update',
      title: 'Original title',
      content: 'Original body',
      contentJson: null,
      boardId: 'board_b',
      statusId: 'status_open',
      principalId: 'principal_author',
      ownerPrincipalId: null,
    }
    updateReturningContentJson = null
    updateReturningTitle = 'Updated title'
  })

  it('calls syncPostMentions once with the mentioned id when a new mention is added on edit', async () => {
    const newContent = docWithMention()
    updateReturningContentJson = newContent
    updateReturningTitle = 'Edited with mention'

    const { updatePost } = await import('../post.service')

    const actorPrincipal = 'principal_actor' as unknown as PrincipalId
    await updatePost(
      'post_update' as unknown as import('@quackback/ids').PostId,
      {
        contentJson: newContent as unknown as import('@/lib/server/db').TiptapContent,
      },
      { principalId: actorPrincipal }
    )

    expect(syncPostMentions).toHaveBeenCalledTimes(1)
    const call = syncPostMentions.mock.calls[0][0]
    expect(call.postId).toBe('post_update')
    expect(call.postTitle).toBe('Edited with mention')
    expect(call.postUrl).toContain('post_update')
    expect(call.mentionedIds).toBeInstanceOf(Set)
    expect(Array.from(call.mentionedIds)).toEqual([MENTIONED])
    expect(call.actor).toMatchObject({ principalId: actorPrincipal })
  })

  it('calls syncPostMentions with an empty set when an edit clears all mentions', async () => {
    // The new body has no mention nodes — sync should still run so the
    // previously-recorded mentions get deleted from post_mentions.
    const newContent = docWithoutMention()
    updateReturningContentJson = newContent
    updateReturningTitle = 'Mentions removed'

    const { updatePost } = await import('../post.service')

    const actorPrincipal = 'principal_actor' as unknown as PrincipalId
    await updatePost(
      'post_update' as unknown as import('@quackback/ids').PostId,
      {
        contentJson: newContent as unknown as import('@/lib/server/db').TiptapContent,
      },
      { principalId: actorPrincipal }
    )

    expect(syncPostMentions).toHaveBeenCalledTimes(1)
    const call = syncPostMentions.mock.calls[0][0]
    expect(call.postId).toBe('post_update')
    expect(call.mentionedIds).toBeInstanceOf(Set)
    expect(call.mentionedIds.size).toBe(0)
    expect(call.excerptByPrincipalId).toBeInstanceOf(Map)
    expect(call.excerptByPrincipalId.size).toBe(0)
  })

  it('does NOT call syncPostMentions when only the title is updated (contentJson untouched)', async () => {
    // Title-only update — must not clobber existing post_mentions rows.
    updateReturningTitle = 'New title only'

    const { updatePost } = await import('../post.service')

    const actorPrincipal = 'principal_actor' as unknown as PrincipalId
    await updatePost(
      'post_update' as unknown as import('@quackback/ids').PostId,
      { title: 'New title only' },
      { principalId: actorPrincipal }
    )

    expect(syncPostMentions).not.toHaveBeenCalled()
  })
})
