import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listCategoriesFn: vi.fn(),
  listPublicCategoriesFn: vi.fn(),
  listArticlesFn: vi.fn(),
  listPublicArticlesFn: vi.fn(),
  listPublicArticlesForCategoryFn: vi.fn(),
  getArticleFn: vi.fn(),
  getPublicArticleBySlugFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/help-center', () => ({
  listCategoriesFn: (input: unknown) => mocks.listCategoriesFn(input),
  listPublicCategoriesFn: (input: unknown) => mocks.listPublicCategoriesFn(input),
  listArticlesFn: (input: unknown) => mocks.listArticlesFn(input),
  listPublicArticlesFn: (input: unknown) => mocks.listPublicArticlesFn(input),
  listPublicArticlesForCategoryFn: (input: unknown) => mocks.listPublicArticlesForCategoryFn(input),
  getArticleFn: (input: unknown) => mocks.getArticleFn(input),
  getPublicArticleBySlugFn: (input: unknown) => mocks.getPublicArticleBySlugFn(input),
}))

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  infiniteQueryOptions: (options: unknown) => options,
}))

import { publicHelpCenterQueries } from '../help-center'

const WIDGET_HEADER = 'X-Quackback-Widget-Context'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('publicHelpCenterQueries.categories', () => {
  it('builds the key without headers and forwards an undefined widget context', async () => {
    const options = publicHelpCenterQueries.categories()
    expect(options.queryKey).toEqual(['help-center', 'public-categories', undefined])
    expect(options.staleTime).toBe(60 * 1000)

    mocks.listPublicCategoriesFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.listPublicCategoriesFn).toHaveBeenCalledWith({ data: {}, headers: undefined })
  })

  it('threads the widget context header into the key and the server fn', async () => {
    const headers = { [WIDGET_HEADER]: 'ctx-1' }
    const options = publicHelpCenterQueries.categories(headers)
    expect(options.queryKey).toEqual(['help-center', 'public-categories', 'ctx-1'])

    mocks.listPublicCategoriesFn.mockResolvedValueOnce([{ id: 'c1' }])
    await options.queryFn!({} as never)

    expect(mocks.listPublicCategoriesFn).toHaveBeenCalledWith({ data: {}, headers })
  })
})

describe('publicHelpCenterQueries.articleList', () => {
  it('builds the key with no category and forwards a paged request', async () => {
    const options = publicHelpCenterQueries.articleList()
    expect(options.queryKey).toEqual(['help-center', 'public', 'list', undefined, undefined])

    mocks.listPublicArticlesFn.mockResolvedValueOnce({ rows: [], nextCursor: null })
    await options.queryFn!({ pageParam: undefined } as never)

    expect(mocks.listPublicArticlesFn).toHaveBeenCalledWith({
      data: { categoryId: undefined, cursor: undefined, limit: 20 },
      headers: undefined,
    })
  })

  it('forwards categoryId, cursor and widget header, and reads nextCursor', async () => {
    const headers = { [WIDGET_HEADER]: 'ctx-2' }
    const options = publicHelpCenterQueries.articleList('cat-1', headers)
    expect(options.queryKey).toEqual(['help-center', 'public', 'list', 'cat-1', 'ctx-2'])

    mocks.listPublicArticlesFn.mockResolvedValueOnce({ rows: [], nextCursor: 'next' })
    await options.queryFn!({ pageParam: 'cursor-1' } as never)

    expect(mocks.listPublicArticlesFn).toHaveBeenCalledWith({
      data: { categoryId: 'cat-1', cursor: 'cursor-1', limit: 20 },
      headers,
    })

    expect(
      (options.getNextPageParam as (p: unknown) => unknown)({ nextCursor: 'next' } as never)
    ).toBe('next')
    expect(
      (options.getNextPageParam as (p: unknown) => unknown)({ nextCursor: null } as never)
    ).toBeUndefined()
  })
})

describe('publicHelpCenterQueries.articleBySlug', () => {
  it('builds the key without headers and forwards the slug', async () => {
    const options = publicHelpCenterQueries.articleBySlug('my-slug')
    expect(options.queryKey).toEqual(['help-center', 'public', 'detail', 'my-slug', undefined])

    mocks.getPublicArticleBySlugFn.mockResolvedValueOnce({ id: 'a1' })
    await options.queryFn!({} as never)

    expect(mocks.getPublicArticleBySlugFn).toHaveBeenCalledWith({
      data: { slug: 'my-slug' },
      headers: undefined,
    })
  })

  it('threads the widget header into the key and the server fn', async () => {
    const headers = { [WIDGET_HEADER]: 'ctx-3' }
    const options = publicHelpCenterQueries.articleBySlug('my-slug', headers)
    expect(options.queryKey).toEqual(['help-center', 'public', 'detail', 'my-slug', 'ctx-3'])

    mocks.getPublicArticleBySlugFn.mockResolvedValueOnce({ id: 'a1' })
    await options.queryFn!({} as never)

    expect(mocks.getPublicArticleBySlugFn).toHaveBeenCalledWith({
      data: { slug: 'my-slug' },
      headers,
    })
  })
})

describe('publicHelpCenterQueries.articlesForCategory', () => {
  it('builds the key without headers and forwards the categoryId', async () => {
    const options = publicHelpCenterQueries.articlesForCategory('cat-9')
    expect(options.queryKey).toEqual([
      'help-center',
      'public',
      'category-articles',
      'cat-9',
      undefined,
    ])

    mocks.listPublicArticlesForCategoryFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.listPublicArticlesForCategoryFn).toHaveBeenCalledWith({
      data: { categoryId: 'cat-9' },
      headers: undefined,
    })
  })

  it('threads the widget header into the key and the server fn', async () => {
    const headers = { [WIDGET_HEADER]: 'ctx-4' }
    const options = publicHelpCenterQueries.articlesForCategory('cat-9', headers)
    expect(options.queryKey).toEqual([
      'help-center',
      'public',
      'category-articles',
      'cat-9',
      'ctx-4',
    ])

    mocks.listPublicArticlesForCategoryFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.listPublicArticlesForCategoryFn).toHaveBeenCalledWith({
      data: { categoryId: 'cat-9' },
      headers,
    })
  })
})
