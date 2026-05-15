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
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'board_b', slug: 'feedback', name: 'Feedback' }),
        },
        postStatuses: {
          findFirst: vi.fn().mockResolvedValue({ id: 'status_open', name: 'Open' }),
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
        }
        return fn(tx)
      }),
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    },
    boards: { id: 'board_id' },
    posts: { __name: 'posts', id: 'post_id' },
    postStatuses: { id: 'status_id' },
    postTags: { __name: 'postTags' },
    votes: { __name: 'votes' },
    principal: { id: 'principal_id' },
    eq: vi.fn(),
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
