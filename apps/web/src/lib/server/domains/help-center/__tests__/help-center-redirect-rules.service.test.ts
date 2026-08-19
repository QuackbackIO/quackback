import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { KbArticleId, KbCategoryId, HcRedirectRuleId } from '@quackback/ids'

const mockArticleFindFirst = vi.fn()
const mockCategoryFindFirst = vi.fn()
const mockRuleFindFirst = vi.fn()
const mockSelectFrom = vi.fn()
const mockDeleteWhere = vi.fn()
const insertValuesCalls: unknown[][] = []

function createInsertChain() {
  const chain: Record<string, unknown> = {}
  chain.values = vi.fn((...args: unknown[]) => {
    insertValuesCalls.push(args)
    return chain
  })
  chain.returning = vi.fn().mockResolvedValue([
    {
      id: 'hc_redirect_rule_new1' as HcRedirectRuleId,
      path: '/old-slug',
      targetType: 'article',
      targetId: 'kb_article_1',
      createdAt: new Date('2026-01-01'),
    },
  ])
  return chain
}

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      helpCenterArticles: { findFirst: (...args: unknown[]) => mockArticleFindFirst(...args) },
      helpCenterCategories: { findFirst: (...args: unknown[]) => mockCategoryFindFirst(...args) },
      helpCenterRedirectRules: { findFirst: (...args: unknown[]) => mockRuleFindFirst(...args) },
    },
    select: vi.fn(() => ({ from: (...args: unknown[]) => mockSelectFrom(...args) })),
    insert: vi.fn(() => createInsertChain()),
    delete: vi.fn(() => ({ where: (...args: unknown[]) => mockDeleteWhere(...args) })),
  },
  eq: (...args: unknown[]) => ({ op: 'eq', args }),
  and: (...args: unknown[]) => ({ op: 'and', args }),
  desc: (...args: unknown[]) => ({ op: 'desc', args }),
  helpCenterRedirectRules: { path: 'path', targetType: 'target_type', targetId: 'target_id', id: 'id' },
  helpCenterArticles: { id: 'id', categoryId: 'category_id' },
  helpCenterCategories: { id: 'id' },
}))

const {
  createRedirectRule,
  deleteRedirectRule,
  deleteRedirectRulesForTarget,
  listRedirectRules,
  resolveRedirectRule,
} = await import('../help-center-redirect-rules.service')

beforeEach(() => {
  mockArticleFindFirst.mockReset()
  mockCategoryFindFirst.mockReset()
  mockRuleFindFirst.mockReset()
  mockSelectFrom.mockReset()
  mockDeleteWhere.mockReset()
  insertValuesCalls.length = 0
})

describe('createRedirectRule', () => {
  it('creates a rule pointing at a published article', async () => {
    mockArticleFindFirst.mockResolvedValue({
      title: 'Getting started',
      publishedAt: new Date('2026-01-01'),
      deletedAt: null,
    })

    const rule = await createRedirectRule({
      path: 'old-slug',
      targetType: 'article',
      targetId: 'kb_article_1' as KbArticleId,
    })

    expect(insertValuesCalls[0][0]).toMatchObject({
      path: '/old-slug',
      targetType: 'article',
      targetId: 'kb_article_1',
    })
    expect(rule.targetLabel).toBe('Getting started')
  })

  it('normalizes the path (adds leading slash, collapses slashes, drops trailing slash)', async () => {
    mockArticleFindFirst.mockResolvedValue({
      title: 'Foo',
      publishedAt: new Date(),
      deletedAt: null,
    })

    await createRedirectRule({
      path: 'foo//bar/',
      targetType: 'article',
      targetId: 'kb_article_1' as KbArticleId,
    })

    expect(insertValuesCalls[0][0]).toMatchObject({ path: '/foo/bar' })
  })

  it('rejects an unpublished article target', async () => {
    mockArticleFindFirst.mockResolvedValue({
      title: 'Draft',
      publishedAt: null,
      deletedAt: null,
    })

    await expect(
      createRedirectRule({
        path: '/foo',
        targetType: 'article',
        targetId: 'kb_article_1' as KbArticleId,
      })
    ).rejects.toThrow(/published/i)
    expect(insertValuesCalls).toHaveLength(0)
  })

  it('rejects a target that does not exist', async () => {
    mockArticleFindFirst.mockResolvedValue(undefined)

    await expect(
      createRedirectRule({
        path: '/foo',
        targetType: 'article',
        targetId: 'kb_article_missing' as KbArticleId,
      })
    ).rejects.toThrow()
  })

  it('rejects a private category target', async () => {
    mockCategoryFindFirst.mockResolvedValue({ name: 'Internal', isPublic: false, deletedAt: null })

    await expect(
      createRedirectRule({
        path: '/foo',
        targetType: 'category',
        targetId: 'kb_category_1' as KbCategoryId,
      })
    ).rejects.toThrow(/public/i)
  })

  it('surfaces a unique-path conflict as a friendly error', async () => {
    mockArticleFindFirst.mockResolvedValue({
      title: 'Foo',
      publishedAt: new Date(),
      deletedAt: null,
    })
    const { db } = await import('@/lib/server/db')
    vi.mocked(db.insert).mockReturnValueOnce({
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockRejectedValue({ code: '23505' }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    await expect(
      createRedirectRule({
        path: '/foo',
        targetType: 'article',
        targetId: 'kb_article_1' as KbArticleId,
      })
    ).rejects.toThrow(/already exists/i)
  })
})

describe('listRedirectRules', () => {
  it('resolves target labels for each rule', async () => {
    mockSelectFrom.mockReturnValue({
      orderBy: vi.fn().mockResolvedValue([
        {
          id: 'hc_redirect_rule_1' as HcRedirectRuleId,
          path: '/old',
          targetType: 'article',
          targetId: 'kb_article_1',
          createdAt: new Date('2026-01-01'),
        },
      ]),
    })
    mockArticleFindFirst.mockResolvedValue({ title: 'Getting started' })

    const rules = await listRedirectRules()
    expect(rules).toHaveLength(1)
    expect(rules[0].targetLabel).toBe('Getting started')
  })
})

describe('deleteRedirectRule / deleteRedirectRulesForTarget', () => {
  it('deletes a single rule by id', async () => {
    await deleteRedirectRule('hc_redirect_rule_1' as HcRedirectRuleId)
    expect(mockDeleteWhere).toHaveBeenCalled()
  })

  it('deletes every rule pointing at a target', async () => {
    await deleteRedirectRulesForTarget('article', 'kb_article_1')
    expect(mockDeleteWhere).toHaveBeenCalled()
  })
})

describe('resolveRedirectRule', () => {
  it('returns null when no rule matches the path', async () => {
    mockRuleFindFirst.mockResolvedValue(undefined)
    expect(await resolveRedirectRule('/nope')).toBeNull()
  })

  it('resolves an article rule to its canonical /hc path', async () => {
    mockRuleFindFirst.mockResolvedValue({
      targetType: 'article',
      targetId: 'kb_article_1',
    })
    mockArticleFindFirst.mockResolvedValue({
      slug: 'getting-started',
      publishedAt: new Date(),
      deletedAt: null,
      category: { slug: 'basics' },
    })

    expect(await resolveRedirectRule('/old-slug')).toBe('/hc/articles/basics/getting-started')
  })

  it('returns null when the article target is no longer published', async () => {
    mockRuleFindFirst.mockResolvedValue({ targetType: 'article', targetId: 'kb_article_1' })
    mockArticleFindFirst.mockResolvedValue({
      slug: 'getting-started',
      publishedAt: null,
      deletedAt: null,
      category: { slug: 'basics' },
    })

    expect(await resolveRedirectRule('/old-slug')).toBeNull()
  })

  it('resolves a category rule to its canonical /hc path', async () => {
    mockRuleFindFirst.mockResolvedValue({ targetType: 'category', targetId: 'kb_category_1' })
    mockCategoryFindFirst.mockResolvedValue({ slug: 'billing', isPublic: true, deletedAt: null })

    expect(await resolveRedirectRule('/old-category')).toBe('/hc/categories/billing')
  })
})
