// @vitest-environment happy-dom

import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

type ComponentProps = {
  children?: ReactNode
  className?: string
  onClick?: () => void
}

type CategoryArticleQuery = {
  data?: Array<{ id: string; slug: string; title: string }>
  isLoading?: boolean
}

type RouteOptions = {
  validateSearch: { parse: (input: unknown) => { categories?: string } }
  loader: (input: { context: { settings?: Record<string, unknown> | null } }) => Promise<{
    categories: unknown
    editors: unknown
    helpCenterConfig: unknown
    workspaceName: string
    logoUrl: string
  }>
  head: (input: {
    loaderData?: {
      helpCenterConfig?: { homepageTitle?: string; homepageDescription?: string } | null
      workspaceName: string
      logoUrl: string
    }
  }) => Record<string, unknown>
  component: () => ReactElement
}

const mocks = vi.hoisted(() => ({
  loaderData: {} as Record<string, unknown>,
  search: {} as { categories?: string },
  navigate: vi.fn(),
  routeContext: {} as { settings?: Record<string, unknown> | null },
  supportAccess: { data: undefined as { granted?: boolean } | undefined },
  categoryArticleQueries: [] as CategoryArticleQuery[],
  listPublicCategoriesFn: vi.fn(async () => [{ id: 'cat-1' }]),
  listPublicCategoryEditorsFn: vi.fn(async () => [{ id: 'editor-1' }]),
  getSupportSurfaceAccessFn: vi.fn(async () => ({ granted: true })),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    fullPath: '/_portal/hc/',
    useLoaderData: () => mocks.loaderData,
    useSearch: () => mocks.search,
    useNavigate: () => mocks.navigate,
    useRouteContext: () => mocks.routeContext,
  }),
  Link: ({ children, to }: ComponentProps & { to?: string }) => <a href={to}>{children}</a>,
  useNavigate: () => mocks.navigate,
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => mocks.supportAccess,
  useQueries: () => mocks.categoryArticleQueries,
}))

vi.mock('react-intl', () => ({
  FormattedMessage: ({ defaultMessage }: { defaultMessage: string }) => <>{defaultMessage}</>,
}))

vi.mock('@/lib/server/functions/help-center', () => ({
  listPublicCategoriesFn: mocks.listPublicCategoriesFn,
  listPublicCategoryEditorsFn: mocks.listPublicCategoryEditorsFn,
}))

vi.mock('@/lib/server/functions/chat', () => ({
  getSupportSurfaceAccessFn: mocks.getSupportSurfaceAccessFn,
}))

vi.mock('@/lib/client/queries/help-center', () => ({
  publicHelpCenterQueries: {
    articlesForCategory: (categoryId: string) => ({
      queryKey: ['help-center', 'public', 'category-articles', categoryId],
    }),
  },
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, asChild }: ComponentProps & { asChild?: boolean }) =>
    asChild ? (
      <>{children}</>
    ) : (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
}))

vi.mock('@/components/help-center/help-center-search', () => ({
  HelpCenterHeroSearch: () => <div data-testid="hero-search" />,
}))

vi.mock('@/components/help-center/help-center-category-grid', () => ({
  HelpCenterCategoryGrid: ({ categories }: { categories: unknown[] }) => (
    <div data-testid="category-grid">{categories.length}</div>
  ),
}))

vi.mock('@heroicons/react/24/outline', () => ({
  ChatBubbleLeftRightIcon: ({ className }: { className?: string }) => <svg className={className} />,
}))

const { Route } = await import('../index')

function routeOptions(): RouteOptions {
  return Route.options as unknown as RouteOptions
}

function renderPage() {
  const Component = routeOptions().component
  return render(<Component />)
}

function seedCategories() {
  return [
    { id: 'cat-1', name: 'Billing', slug: 'billing' },
    { id: 'cat-2', name: 'Account', slug: 'account' },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.search = {}
  mocks.routeContext = { settings: undefined }
  mocks.supportAccess = { data: undefined }
  mocks.categoryArticleQueries = []
  mocks.loaderData = {
    categories: seedCategories(),
    editors: [{ id: 'editor-1' }],
    helpCenterConfig: null,
  }
})

describe('help center landing route — loader & head', () => {
  it('loads categories/editors and applies defaults when settings absent', async () => {
    const result = await routeOptions().loader({ context: { settings: undefined } })
    expect(mocks.listPublicCategoriesFn).toHaveBeenCalledWith({ data: {} })
    expect(mocks.listPublicCategoryEditorsFn).toHaveBeenCalledWith({ data: {} })
    expect(result).toMatchObject({
      categories: [{ id: 'cat-1' }],
      editors: [{ id: 'editor-1' }],
      helpCenterConfig: null,
      workspaceName: 'Help Center',
      logoUrl: '/logo.png',
    })
  })

  it('uses provided settings (helpCenterConfig, name, logo)', async () => {
    const result = await routeOptions().loader({
      context: {
        settings: {
          helpCenterConfig: { homepageTitle: 'Hi' },
          name: 'Acme',
          brandingData: { logoUrl: 'https://cdn/logo.svg' },
        },
      },
    })
    expect(result).toMatchObject({
      helpCenterConfig: { homepageTitle: 'Hi' },
      workspaceName: 'Acme',
      logoUrl: 'https://cdn/logo.svg',
    })
  })

  it('head returns empty object without loaderData', () => {
    expect(routeOptions().head({})).toEqual({})
  })

  it('head builds meta with config overrides', () => {
    const head = routeOptions().head({
      loaderData: {
        helpCenterConfig: { homepageTitle: 'Custom', homepageDescription: 'Desc' },
        workspaceName: 'Acme',
        logoUrl: '/logo.png',
      },
    }) as { meta: Array<{ title?: string; content?: string }> }
    expect(head.meta[0]).toEqual({ title: 'Custom - Acme' })
    expect(head.meta).toEqual(expect.arrayContaining([{ name: 'description', content: 'Desc' }]))
  })

  it('head falls back to defaults when config fields missing', () => {
    const head = routeOptions().head({
      loaderData: {
        helpCenterConfig: null,
        workspaceName: 'Acme',
        logoUrl: '/logo.png',
      },
    }) as { meta: Array<{ title?: string }> }
    expect(head.meta[0]).toEqual({ title: 'How can we help? - Acme' })
  })
})

describe('help center landing route — validateSearch', () => {
  it('accepts a categories string', () => {
    expect(routeOptions().validateSearch.parse({ categories: 'cat-1,cat-2' })).toEqual({
      categories: 'cat-1,cat-2',
    })
  })

  it('accepts an empty object (categories optional)', () => {
    expect(routeOptions().validateSearch.parse({})).toEqual({})
  })
})

describe('help center landing route — component selection logic', () => {
  it('selects all categories when search has no categories param', () => {
    mocks.categoryArticleQueries = [
      { data: [{ id: 'a-1', slug: 'a1', title: 'Article 1' }], isLoading: false },
      { data: [], isLoading: false },
    ]
    renderPage()

    // header + grid rendered
    expect(screen.getByTestId('category-grid').textContent).toBe('2')
    // both category sections present (all selected -> both shown)
    expect(screen.getByText('Article 1')).toBeTruthy()
    expect(screen.getByText('No entries in this category.')).toBeTruthy()
    // all selected -> "Show all" button hidden
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull()
  })

  it('filters to allowed ids from the search param and shows the Show all button', () => {
    mocks.search = { categories: ' cat-1 , bogus , ' }
    mocks.categoryArticleQueries = [
      { data: [{ id: 'a-1', slug: 'a1', title: 'Only Billing' }], isLoading: false },
    ]
    renderPage()

    expect(screen.getByText('Only Billing')).toBeTruthy()
    // subset selected -> Show all visible
    expect(screen.getByRole('button', { name: 'Show all' })).toBeTruthy()
  })

  it('falls back to all categories when filtered selection is empty', () => {
    mocks.search = { categories: 'nope,unknown' }
    mocks.categoryArticleQueries = [
      { data: [], isLoading: false },
      { data: [], isLoading: false },
    ]
    renderPage()
    // empty filter -> availableCategoryIds (all) -> Show all hidden again
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull()
    expect(screen.getAllByText('No entries in this category.').length).toBe(2)
  })

  it('renders loading state for category sections', () => {
    mocks.categoryArticleQueries = [
      { data: undefined, isLoading: true },
      { data: undefined, isLoading: true },
    ]
    renderPage()
    expect(screen.getAllByText('Loading entries…').length).toBe(2)
  })

  it('renders nothing for the section when there are no categories', () => {
    mocks.loaderData = { categories: [], editors: [], helpCenterConfig: null }
    renderPage()
    expect(screen.queryByText('Browse by selected categories')).toBeNull()
  })
})

describe('help center landing route — toggling categories', () => {
  it('clicking Show all selects every category (normalized to empty -> undefined)', () => {
    mocks.search = { categories: 'cat-1' }
    mocks.categoryArticleQueries = [{ data: [], isLoading: false }]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ replace: true, search: expect.any(Function) })
    )
    const updater = mocks.navigate.mock.calls[0][0].search as (
      prev: Record<string, unknown>
    ) => Record<string, unknown>
    // all selected >= available length -> categories undefined
    expect(updater({ foo: 'bar' })).toEqual({ foo: 'bar', categories: undefined })
  })

  it('deselecting an already-selected chip removes it from the search', () => {
    // all selected (no search) -> clicking cat-1 chip removes it leaving cat-2
    mocks.categoryArticleQueries = [
      { data: [], isLoading: false },
      { data: [], isLoading: false },
    ]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Billing' }))
    const updater = mocks.navigate.mock.calls[0][0].search as (
      prev: Record<string, unknown>
    ) => Record<string, unknown>
    // remaining [cat-2] < available length(2) -> joined string
    expect(updater({})).toEqual({ categories: 'cat-2' })
  })

  it('selecting an unselected chip adds it back', () => {
    mocks.search = { categories: 'cat-1' }
    mocks.categoryArticleQueries = [{ data: [], isLoading: false }]
    renderPage()

    // cat-2 is not selected -> clicking adds it; cat-1+cat-2 == all -> undefined
    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    const updater = mocks.navigate.mock.calls[0][0].search as (
      prev: Record<string, unknown>
    ) => Record<string, unknown>
    expect(updater({})).toEqual({ categories: undefined })
  })
})

describe('help center landing route — support CTA & titles', () => {
  it('hides the support CTA when support is not configured', () => {
    mocks.routeContext = { settings: {} }
    mocks.supportAccess = { data: { granted: true } }
    renderPage()
    expect(screen.queryByText('Contact support')).toBeNull()
  })

  it('shows the support CTA when configured and access granted', () => {
    mocks.routeContext = {
      settings: {
        featureFlags: { supportInbox: true },
        portalConfig: { support: { enabled: true } },
      },
    }
    mocks.supportAccess = { data: { granted: true } }
    renderPage()
    expect(screen.getByText('Contact support')).toBeTruthy()
    expect(screen.getByText('Still need help?')).toBeTruthy()
  })

  it('hides the CTA when configured but access not granted', () => {
    mocks.routeContext = {
      settings: {
        featureFlags: { supportInbox: true },
        portalConfig: { support: { enabled: true } },
      },
    }
    mocks.supportAccess = { data: { granted: false } }
    renderPage()
    expect(screen.queryByText('Contact support')).toBeNull()
  })

  it('renders custom title/description from helpCenterConfig', () => {
    mocks.loaderData = {
      categories: seedCategories(),
      editors: [],
      helpCenterConfig: { homepageTitle: 'Need a hand?', homepageDescription: 'Look here' },
    }
    mocks.categoryArticleQueries = [
      { data: [], isLoading: false },
      { data: [], isLoading: false },
    ]
    renderPage()
    expect(screen.getByText('Need a hand?')).toBeTruthy()
    expect(screen.getByText('Look here')).toBeTruthy()
  })
})
