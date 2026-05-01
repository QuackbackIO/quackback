/**
 * Regression guard: createPost must derive the auto-upvote (and the row's
 * principal_id) from author.principalId, so the import handler's override
 * lands on every attributed row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardId, PrincipalId, StatusId } from '@quackback/ids'

const insertedRows: Record<string, unknown[]> = { posts: [], votes: [], postTags: [] }
const subscribeToPost = vi.fn()

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
        return [
          {
            id: 'post_new' as unknown,
            boardId: 'board_b' as unknown,
            statusId: 'status_open' as unknown,
            title: 'New post',
            content: 'Body',
            principalId: (insertedRows.posts.at(-1) as { principalId: string }).principalId,
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
                : (table.__name ?? (table as { [k: string]: unknown }).name ?? 'posts')
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
    eq: vi.fn(),
    sql: realSql,
  }
})

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  subscribeToPost: (...args: unknown[]) => subscribeToPost(...args),
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchPostCreated: vi.fn(),
  buildEventActor: vi.fn(() => ({})),
}))

vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  createActivity: vi.fn(),
}))

vi.mock('@/lib/server/markdown-tiptap', () => ({
  markdownToTiptapJson: vi.fn(() => ({})),
}))

vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: vi.fn(async (json: unknown) => json),
}))

describe('createPost author attribution', () => {
  beforeEach(() => {
    insertedRows.posts.length = 0
    insertedRows.votes.length = 0
    insertedRows.postTags.length = 0
    subscribeToPost.mockClear()
  })

  it('attributes the post row, the auto-upvote, and the subscription to author.principalId', async () => {
    const { createPost } = await import('../post.service')

    const overridePrincipal = 'principal_override' as unknown as PrincipalId
    await createPost(
      {
        boardId: 'board_b' as unknown as BoardId,
        title: 'New post',
        content: 'Body',
        statusId: 'status_open' as unknown as StatusId,
      },
      { principalId: overridePrincipal }
    )

    const postRow = insertedRows.posts[0] as { principalId: PrincipalId }
    const voteRow = insertedRows.votes[0] as { principalId: PrincipalId }
    expect(postRow.principalId).toBe(overridePrincipal)
    expect(voteRow.principalId).toBe(overridePrincipal)
    expect(subscribeToPost).toHaveBeenCalledWith(overridePrincipal, 'post_new', 'author')
  })
})
