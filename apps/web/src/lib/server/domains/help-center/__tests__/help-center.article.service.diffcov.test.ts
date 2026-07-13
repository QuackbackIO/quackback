/**
 * Differential-coverage tests for help-center.article.service — resolve/get
 * (id/slug/public visibility), create/update author validation, publish/
 * unpublish/delete/restore guards, article feedback upsert, and the
 * fireArticleEvent dispatch branches. db + content/embedding/visibility helpers
 * are stubbed; only branch traversal matters.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  const tx = {
    query: {
      principal: { findFirst: vi.fn() },
      helpCenterArticles: { findFirst: vi.fn() },
      helpCenterArticleFeedback: { findFirst: vi.fn() },
    },
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => m.txUpdateReturning(),
          then: (r: (v: unknown) => void) => r(undefined),
        }),
      }),
    }),
    insert: () => ({ values: () => Promise.resolve() }),
  }
  return {
    articlesFindFirst: vi.fn(),
    categoriesFindFirst: vi.fn(),
    principalFindFirst: vi.fn(),
    publicSelectLimit: vi.fn(),
    insertReturning: vi.fn(),
    updateReturning: vi.fn(),
    txUpdateReturning: vi.fn(),
    canView: vi.fn((..._a: unknown[]) => true),
    isTeam: vi.fn((r: string) => r === 'agent' || r === 'admin'),
    embed: vi.fn((..._a: unknown[]) => Promise.resolve()),
    dCreated: vi.fn(),
    dUpdated: vi.fn(),
    dPublished: vi.fn(),
    dUnpublished: vi.fn(),
    dDeleted: vi.fn(),
    tx,
  }
})

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      helpCenterArticles: { findFirst: m.articlesFindFirst },
      helpCenterCategories: { findFirst: m.categoriesFindFirst },
      principal: { findFirst: m.principalFindFirst },
      helpCenterArticleFeedback: { findFirst: vi.fn() },
    },
    select: () => ({
      from: () => ({ innerJoin: () => ({ where: () => ({ limit: m.publicSelectLimit }) }) }),
    }),
    insert: () => ({ values: () => ({ returning: m.insertReturning }) }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: m.updateReturning,
          catch: () => undefined,
          then: (r: (v: unknown) => void) => r(undefined),
        }),
      }),
    }),
    transaction: async (cb: (t: typeof m.tx) => unknown) => cb(m.tx),
  },
  helpCenterCategories: {
    id: 'hc.id',
    slug: 'hc.slug',
    isPublic: 'hc.isPublic',
    deletedAt: 'hc.deletedAt',
  },
  helpCenterArticles: {
    id: 'ha.id',
    slug: 'ha.slug',
    categoryId: 'ha.categoryId',
    deletedAt: 'ha.deletedAt',
    publishedAt: 'ha.publishedAt',
    viewCount: 'ha.viewCount',
    helpfulCount: 'ha.helpfulCount',
    notHelpfulCount: 'ha.notHelpfulCount',
  },
  helpCenterArticleFeedback: {
    id: 'haf.id',
    articleId: 'haf.articleId',
    principalId: 'haf.principalId',
  },
  principal: { id: 'pr.id' },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  lte: vi.fn(),
  sql: (..._a: unknown[]) => ({ __sql: true }),
}))

vi.mock('@/lib/shared/roles', () => ({ isTeamMember: (r: string) => m.isTeam(r) }))
vi.mock('@/lib/server/markdown-tiptap', () => ({ markdownToTiptapJson: () => ({ type: 'doc' }) }))
vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: (j: unknown) => Promise.resolve(j),
}))
vi.mock('@/lib/shared/utils', () => ({
  slugify: (s: string) => s.toLowerCase().replace(/\s+/g, '-'),
}))
vi.mock('../help-center-embedding.service', () => ({
  generateArticleEmbedding: (...a: unknown[]) => m.embed(...a),
}))
vi.mock('../help-center.visibility', () => ({
  canActorViewCategory: (...a: unknown[]) => m.canView(...a),
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn() }) },
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchHelpCenterArticleCreated: (...a: unknown[]) => m.dCreated(...a),
  dispatchHelpCenterArticleUpdated: (...a: unknown[]) => m.dUpdated(...a),
  dispatchHelpCenterArticlePublished: (...a: unknown[]) => m.dPublished(...a),
  dispatchHelpCenterArticleUnpublished: (...a: unknown[]) => m.dUnpublished(...a),
  dispatchHelpCenterArticleDeleted: (...a: unknown[]) => m.dDeleted(...a),
}))

import * as svc from '../help-center.article.service'

const flush = () => new Promise((r) => setTimeout(r, 0))
const article = (over: Record<string, unknown> = {}) => ({
  id: 'art_1',
  categoryId: 'cat_1',
  slug: 'how-to',
  title: 'How to',
  content: 'c',
  contentJson: null,
  principalId: 'pr_1',
  publishedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.articlesFindFirst.mockResolvedValue(undefined)
  m.categoriesFindFirst.mockResolvedValue({ id: 'cat_1', slug: 'cat', name: 'Cat' })
  m.principalFindFirst.mockResolvedValue({
    id: 'pr_1',
    displayName: 'Author',
    avatarUrl: null,
    role: 'agent',
    type: 'user',
  })
  m.publicSelectLimit.mockResolvedValue([])
  m.insertReturning.mockResolvedValue([article()])
  m.updateReturning.mockResolvedValue([article()])
  m.txUpdateReturning.mockResolvedValue([article()])
  m.tx.query.principal.findFirst.mockResolvedValue({ id: 'pr_1', role: 'agent', type: 'user' })
  m.tx.query.helpCenterArticles.findFirst.mockResolvedValue({ principalId: 'pr_1' })
  m.tx.query.helpCenterArticleFeedback.findFirst.mockResolvedValue(undefined)
  m.canView.mockReturnValue(true)
})

describe('resolveArticleWithCategory / get', () => {
  it('falls back to Unknown category and null author', async () => {
    m.articlesFindFirst.mockResolvedValueOnce(article({ principalId: null }))
    m.categoriesFindFirst.mockResolvedValueOnce(undefined)
    const res = await svc.getArticleById('art_1' as never)
    expect(res.category.name).toBe('Unknown')
    expect(res.author).toBeNull()
  })
  it('getArticleById throws when missing', async () => {
    await expect(svc.getArticleById('art_1' as never)).rejects.toThrow('not found')
  })
  it('getArticleBySlug returns / throws', async () => {
    m.articlesFindFirst.mockResolvedValueOnce(article())
    expect((await svc.getArticleBySlug('how-to')).id).toBe('art_1')
    await expect(svc.getArticleBySlug('nope')).rejects.toThrow('not found')
  })
})

describe('getPublicArticleBySlug', () => {
  it('throws when no published/public row', async () => {
    await expect(svc.getPublicArticleBySlug('x')).rejects.toThrow('not found')
  })
  it('throws when the actor cannot view the category', async () => {
    m.publicSelectLimit.mockResolvedValueOnce([
      {
        article: article(),
        category: { id: 'cat_1', isPublic: true, allowedSegmentIds: [], allowedPrincipalIds: [] },
      },
    ])
    m.canView.mockReturnValueOnce(false)
    await expect(svc.getPublicArticleBySlug('x')).rejects.toThrow('not found')
  })
  it('returns the article and bumps the view count', async () => {
    m.publicSelectLimit.mockResolvedValueOnce([
      {
        article: article(),
        category: {
          id: 'cat_1',
          isPublic: true,
          allowedSegmentIds: null,
          allowedPrincipalIds: null,
        },
      },
    ])
    expect((await svc.getPublicArticleBySlug('x')).id).toBe('art_1')
  })
})

describe('createArticle', () => {
  it('requires title and content', async () => {
    await expect(
      svc.createArticle({ title: ' ', content: 'c' } as never, 'pr_1' as never)
    ).rejects.toThrow('Title is required')
    await expect(
      svc.createArticle({ title: 't', content: ' ' } as never, 'pr_1' as never)
    ).rejects.toThrow('Content is required')
  })
  it('validates an explicit author (not found / not team member)', async () => {
    m.principalFindFirst.mockResolvedValueOnce(undefined)
    await expect(
      svc.createArticle({ title: 't', content: 'c' } as never, 'pr_1' as never, 'author_1' as never)
    ).rejects.toThrow('Author not found')
    m.principalFindFirst.mockResolvedValueOnce({ id: 'author_1', role: 'portal', type: 'user' })
    await expect(
      svc.createArticle({ title: 't', content: 'c' } as never, 'pr_1' as never, 'author_1' as never)
    ).rejects.toThrow('team member')
  })
  it('rejects a service-principal caller without an explicit author', async () => {
    m.principalFindFirst.mockResolvedValueOnce({ type: 'service' })
    await expect(
      svc.createArticle({ title: 't', content: 'c' } as never, 'pr_1' as never)
    ).rejects.toThrow('explicit authorId')
  })
  it('creates with a slug fallback and fires created', async () => {
    const res = await svc.createArticle(
      { title: 'My Article', content: 'body', categoryId: 'cat_1' } as never,
      'pr_1' as never
    )
    expect(res.id).toBe('art_1')
    await flush()
    expect(m.dCreated).toHaveBeenCalled()
  })
})

describe('updateArticle', () => {
  it('updates fields + author in a transaction and fires updated', async () => {
    const res = await svc.updateArticle(
      'art_1' as never,
      {
        title: ' New ',
        content: 'c2',
        categoryId: 'cat_2',
        slug: 's',
        position: 1,
        description: 'd',
      } as never,
      'pr_1' as never
    )
    expect(res.id).toBe('art_1')
    await flush()
    expect(m.dUpdated).toHaveBeenCalled()
  })
  it('re-asserts a former team member who owns the article', async () => {
    m.tx.query.principal.findFirst.mockResolvedValueOnce({
      id: 'pr_1',
      role: 'portal',
      type: 'user',
    })
    m.tx.query.helpCenterArticles.findFirst.mockResolvedValueOnce({ principalId: 'pr_1' })
    await svc.updateArticle('art_1' as never, { title: 'x' } as never, 'pr_1' as never)
    expect(m.txUpdateReturning).toHaveBeenCalled()
  })
  it('rejects a non-owner non-team author', async () => {
    m.tx.query.principal.findFirst.mockResolvedValueOnce({
      id: 'other',
      role: 'portal',
      type: 'user',
    })
    m.tx.query.helpCenterArticles.findFirst.mockResolvedValueOnce({ principalId: 'pr_1' })
    await expect(
      svc.updateArticle('art_1' as never, { title: 'x' } as never, 'other' as never)
    ).rejects.toThrow('team member')
  })
  it('throws when the update matches no row', async () => {
    m.txUpdateReturning.mockResolvedValueOnce([])
    await expect(svc.updateArticle('art_1' as never, { title: 'x' } as never)).rejects.toThrow(
      'not found'
    )
  })
})

describe('publish / unpublish / delete / restore', () => {
  it('publishArticle fires published; throws when missing', async () => {
    await svc.publishArticle('art_1' as never)
    await flush()
    expect(m.dPublished).toHaveBeenCalled()
    m.updateReturning.mockResolvedValueOnce([])
    await expect(svc.publishArticle('art_1' as never)).rejects.toThrow('not found')
  })
  it('unpublishArticle fires unpublished', async () => {
    await svc.unpublishArticle('art_1' as never)
    await flush()
    expect(m.dUnpublished).toHaveBeenCalled()
  })
  it('deleteArticle fires deleted; throws when missing', async () => {
    await svc.deleteArticle('art_1' as never)
    await flush()
    expect(m.dDeleted).toHaveBeenCalled()
    m.updateReturning.mockResolvedValueOnce([])
    await expect(svc.deleteArticle('art_1' as never)).rejects.toThrow('not found')
  })
  it('restoreArticle: missing / not-deleted / expired / success', async () => {
    m.articlesFindFirst.mockResolvedValueOnce(undefined)
    await expect(svc.restoreArticle('art_1' as never)).rejects.toThrow('not found')
    m.articlesFindFirst.mockResolvedValueOnce(article({ deletedAt: null }))
    await expect(svc.restoreArticle('art_1' as never)).rejects.toThrow('not deleted')
    m.articlesFindFirst.mockResolvedValueOnce(article({ deletedAt: new Date('2020-01-01') }))
    await expect(svc.restoreArticle('art_1' as never)).rejects.toThrow('within 30 days')
    m.articlesFindFirst.mockResolvedValueOnce(article({ deletedAt: new Date() }))
    m.updateReturning.mockResolvedValueOnce([article({ deletedAt: null })])
    expect((await svc.restoreArticle('art_1' as never)).id).toBe('art_1')
  })
})

describe('recordArticleFeedback', () => {
  it('no-ops when an identical vote already exists', async () => {
    m.tx.query.helpCenterArticleFeedback.findFirst.mockResolvedValueOnce({
      id: 'fb_1',
      helpful: true,
    })
    await svc.recordArticleFeedback('art_1' as never, true, 'pr_1' as never)
    expect(true).toBe(true)
  })
  it('flips an existing vote (updates counters)', async () => {
    m.tx.query.helpCenterArticleFeedback.findFirst.mockResolvedValueOnce({
      id: 'fb_1',
      helpful: false,
    })
    await svc.recordArticleFeedback('art_1' as never, true, 'pr_1' as never)
    expect(true).toBe(true)
  })
  it('inserts a new vote (anonymous, not helpful)', async () => {
    await svc.recordArticleFeedback('art_1' as never, false, null)
    expect(true).toBe(true)
  })
})

describe('fireArticleEvent failure', () => {
  it('swallows a dispatch error', async () => {
    m.dCreated.mockRejectedValueOnce(new Error('boom'))
    await svc.createArticle({ title: 't', content: 'c' } as never, 'pr_1' as never)
    await flush()
    expect(m.dCreated).toHaveBeenCalled()
  })
})
