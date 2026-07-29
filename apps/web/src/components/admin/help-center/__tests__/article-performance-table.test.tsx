// @vitest-environment happy-dom
/**
 * The article-performance table leads with a synthesis tier -- headline stat
 * tiles and a "needs attention" callout for the worst-received article --
 * so an admin reads the story before scanning row-level detail.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))
vi.mock('@/routes/admin/help-center', () => ({
  Route: { fullPath: '/admin/help-center' },
}))

const hoisted = vi.hoisted(() => ({
  listArticlePerformanceFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/help-center', () => ({
  listArticlePerformanceFn: hoisted.listArticlePerformanceFn,
}))

import { ArticlePerformanceTable } from '../article-performance-table'

const ROWS = [
  {
    id: 'kb_article_1',
    slug: 'getting-started',
    title: 'Getting started',
    status: 'published' as const,
    categoryName: 'Onboarding',
    viewCount: 1000,
    helpfulCount: 90,
    notHelpfulCount: 10,
  },
  {
    id: 'kb_article_2',
    slug: 'billing-faq',
    title: 'Billing FAQ',
    status: 'published' as const,
    categoryName: 'Billing',
    viewCount: 400,
    helpfulCount: 5,
    notHelpfulCount: 20,
  },
  {
    id: 'kb_article_3',
    slug: 'api-keys',
    title: 'API keys',
    status: 'draft' as const,
    categoryName: 'Developers',
    viewCount: 120,
    helpfulCount: 0,
    notHelpfulCount: 0,
  },
]

afterEach(() => {
  cleanup()
  navigate.mockClear()
  hoisted.listArticlePerformanceFn.mockClear()
})

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('ArticlePerformanceTable', () => {
  it('renders aggregate stat tiles synthesized from every row', async () => {
    hoisted.listArticlePerformanceFn.mockResolvedValue(ROWS)
    renderWithClient(<ArticlePerformanceTable />)

    // Total views: 1000 + 400 + 120
    expect(await screen.findByText('1,520')).toBeInTheDocument()
    // Total helpful: 90 + 5 + 0
    expect(screen.getByText('95')).toBeInTheDocument()
    // Total not-helpful: 10 + 20 + 0
    expect(screen.getByText('30')).toBeInTheDocument()
    // Overall rate: 95 / 125 = 76%
    expect(screen.getByText('76%')).toBeInTheDocument()
  })

  it('calls out the worst-reacted article ahead of the row-level table', async () => {
    hoisted.listArticlePerformanceFn.mockResolvedValue(ROWS)
    renderWithClient(<ArticlePerformanceTable />)

    // Billing FAQ has the lowest helpful rate (5 / 25 = 20%) among articles
    // with any votes cast, and should be named in a callout, not left for
    // the admin to find by scanning the table.
    const callout = await screen.findByTestId('article-performance-worst')
    expect(callout).toHaveTextContent('Billing FAQ')
    expect(callout).toHaveTextContent('20%')
  })

  it('omits the worst-reacted callout when no article has received any votes', async () => {
    hoisted.listArticlePerformanceFn.mockResolvedValue([
      { ...ROWS[2], id: 'kb_article_4', title: 'Untouched article' },
    ])
    renderWithClient(<ArticlePerformanceTable />)

    await screen.findByText('Untouched article')
    expect(screen.queryByTestId('article-performance-worst')).not.toBeInTheDocument()
  })
})
