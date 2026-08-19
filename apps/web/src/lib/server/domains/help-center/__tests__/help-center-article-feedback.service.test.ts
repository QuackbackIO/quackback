/**
 * Tests for the free-text reason attached to an unhelpful article vote.
 *
 * The reason is write-once and belongs to the unhelpful vote it explains, so
 * the update is expressed as a guarded UPDATE ... WHERE helpful = false AND
 * reason IS NULL rather than a read-then-write.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { createId } from '@quackback/ids'
import type { KbArticleFeedbackId, KbArticleId, PrincipalId } from '@quackback/ids'

const insertValuesCalls: unknown[][] = []
const updateSetCalls: unknown[][] = []
const updateWhereCalls: unknown[][] = []

/**
 * The WHERE clause of an UPDATE, rendered as SQL text.
 *
 * The write-once rule lives entirely in that clause, so reading it back is the
 * only way to tell a guarded update from an unguarded one -- both look
 * identical from the row a mocked driver hands back.
 */
function compiledWhere(callIndex: number): string {
  const [clause] = updateWhereCalls[callIndex] as [SQL]
  return new PgDialect().sqlToQuery(clause).sql
}

const mockFeedbackFindFirst = vi.fn()
const mockFeedbackFindMany = vi.fn()

/** Rows the guarded reason UPDATE reports back; [] models "no row matched". */
let updateReturningRows: unknown[] = []

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      helpCenterArticleFeedback: {
        findFirst: (...args: unknown[]) => mockFeedbackFindFirst(...args),
        findMany: (...args: unknown[]) => mockFeedbackFindMany(...args),
      },
      helpCenterCategories: { findFirst: vi.fn() },
      helpCenterArticles: { findFirst: vi.fn(), findMany: vi.fn() },
      principal: { findFirst: vi.fn() },
    },
    insert: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      chain.values = vi.fn((...args: unknown[]) => {
        insertValuesCalls.push(args)
        return chain
      })
      chain.returning = vi.fn().mockResolvedValue([])
      return chain
    }),
    update: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      chain.set = vi.fn((...args: unknown[]) => {
        updateSetCalls.push(args)
        return chain
      })
      chain.where = vi.fn((...args: unknown[]) => {
        updateWhereCalls.push(args)
        return chain
      })
      chain.returning = vi.fn(async () => updateReturningRows)
      return chain
    }),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const self = (await import('@/lib/server/db')).db
      return fn(self)
    }),
  },
}))

vi.mock('@/lib/server/markdown-tiptap', () => ({
  markdownToTiptapJson: vi.fn(() => ({ type: 'doc', content: [] })),
  contentJsonToMarkdown: (_json: unknown, fallback: string) => fallback,
  projectContentJsonToMarkdown: (_json: unknown, fallback: string) => fallback,
}))

let recordArticleFeedback: typeof import('../help-center.article-feedback.service').recordArticleFeedback
let attachArticleFeedbackReason: typeof import('../help-center.article-feedback.service').attachArticleFeedbackReason
let listArticleFeedbackReasons: typeof import('../help-center.article-feedback.service').listArticleFeedbackReasons

beforeEach(async () => {
  vi.clearAllMocks()
  insertValuesCalls.length = 0
  updateSetCalls.length = 0
  updateWhereCalls.length = 0
  updateReturningRows = []
  mockFeedbackFindFirst.mockResolvedValue(null)
  mockFeedbackFindMany.mockResolvedValue([])

  const mod = await import('../help-center.article-feedback.service')
  recordArticleFeedback = mod.recordArticleFeedback
  attachArticleFeedbackReason = mod.attachArticleFeedbackReason
  listArticleFeedbackReasons = mod.listArticleFeedbackReasons
})

describe('recordArticleFeedback', () => {
  it('returns the id of the vote it inserted so an anonymous visitor can explain it', async () => {
    const feedbackId = await recordArticleFeedback('kb_article_1' as KbArticleId, false)

    expect(feedbackId).toMatch(/^kb_article_feedback_/)
    const [inserted] = insertValuesCalls[0] as [{ id: string; helpful: boolean }]
    expect(inserted.id).toBe(feedbackId)
    expect(inserted.helpful).toBe(false)
  })

  it('returns the existing id when a known visitor repeats the same vote', async () => {
    mockFeedbackFindFirst.mockResolvedValue({
      id: 'kb_article_feedback_1',
      articleId: 'kb_article_1',
      principalId: 'principal_1',
      helpful: false,
      reason: 'Missing the CLI flag',
    })

    const feedbackId = await recordArticleFeedback(
      'kb_article_1' as KbArticleId,
      false,
      'principal_1' as PrincipalId
    )

    expect(feedbackId).toBe('kb_article_feedback_1')
    expect(insertValuesCalls).toHaveLength(0)
  })

  it('clears the reason when a vote flips to helpful', async () => {
    mockFeedbackFindFirst.mockResolvedValue({
      id: 'kb_article_feedback_1',
      articleId: 'kb_article_1',
      principalId: 'principal_1',
      helpful: false,
      reason: 'Missing the CLI flag',
    })

    await recordArticleFeedback('kb_article_1' as KbArticleId, true, 'principal_1' as PrincipalId)

    expect(updateSetCalls[0]).toEqual([{ helpful: true, reason: null }])
  })
})

describe('attachArticleFeedbackReason', () => {
  it('stores the trimmed reason', async () => {
    updateReturningRows = [{ id: 'kb_article_feedback_1' }]

    await attachArticleFeedbackReason(
      'kb_article_feedback_1' as KbArticleFeedbackId,
      '  The steps stop before the deploy part.  '
    )

    expect(updateSetCalls[0]).toEqual([{ reason: 'The steps stop before the deploy part.' }])
  })

  it('rejects a blank reason without touching the row', async () => {
    await expect(
      attachArticleFeedbackReason('kb_article_feedback_1' as KbArticleFeedbackId, '   \n  ')
    ).rejects.toMatchObject({ code: 'FEEDBACK_REASON_EMPTY' })

    expect(updateSetCalls).toHaveLength(0)
  })

  it('rejects a reason longer than the stored maximum', async () => {
    await expect(
      attachArticleFeedbackReason('kb_article_feedback_1' as KbArticleFeedbackId, 'x'.repeat(1001))
    ).rejects.toMatchObject({ code: 'FEEDBACK_REASON_TOO_LONG' })

    expect(updateSetCalls).toHaveLength(0)
  })

  it('refuses a second reason for the same vote', async () => {
    updateReturningRows = []

    await expect(
      attachArticleFeedbackReason('kb_article_feedback_1' as KbArticleFeedbackId, 'Second thoughts')
    ).rejects.toMatchObject({ code: 'FEEDBACK_REASON_UNAVAILABLE' })
  })

  it('narrows the write to an unhelpful vote that has no reason yet', async () => {
    updateReturningRows = [{ id: 'kb_article_feedback_1' }]

    await attachArticleFeedbackReason(
      createId('kb_article_feedback'),
      'The steps stop before the deploy part.'
    )

    // Holding a vote id is not authority to overwrite what it already says, so
    // the row must be selected by more than its id: an id-only WHERE would let
    // any holder rewrite a reason, or write one onto a helpful vote.
    const where = compiledWhere(0)
    expect(where).toContain('"kb_article_feedback"."id" =')
    expect(where).toContain('"kb_article_feedback"."helpful" =')
    expect(where).toContain('"kb_article_feedback"."reason" is null')
  })
})

describe('listArticleFeedbackReasons', () => {
  it('returns the stored reasons for an article', async () => {
    mockFeedbackFindMany.mockResolvedValue([
      {
        id: 'kb_article_feedback_2',
        reason: 'The screenshots are out of date',
        createdAt: new Date('2024-03-02'),
      },
      {
        id: 'kb_article_feedback_1',
        reason: 'Missing the CLI flag',
        createdAt: new Date('2024-03-01'),
      },
    ])

    const reasons = await listArticleFeedbackReasons('kb_article_1' as KbArticleId)

    expect(reasons.map((r) => r.reason)).toEqual([
      'The screenshots are out of date',
      'Missing the CLI flag',
    ])
  })

  it('caps the page size it asks the database for', async () => {
    await listArticleFeedbackReasons('kb_article_1' as KbArticleId, 500)

    const [query] = mockFeedbackFindMany.mock.calls[0] as [{ limit: number }]
    expect(query.limit).toBe(100)
  })
})
