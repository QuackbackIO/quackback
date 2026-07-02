// @vitest-environment happy-dom
/**
 * Differential-coverage tests for the portal /changelog route — the tab-enabled
 * beforeLoad gate, the loader's parallel fetch + context fallbacks, and the page
 * component (including the category/product navigate callbacks).
 */
import type { ReactNode, ReactElement } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'

const routeData = vi.hoisted(() => ({
  useLoaderData: vi.fn(),
  useSearch: vi.fn(),
  useNavigate: vi.fn(),
}))
const m = vi.hoisted(() => ({ visibility: vi.fn(), taxonomy: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (cfg: unknown) => ({ options: cfg, ...routeData }),
  redirect: (opts: unknown) => Object.assign(new Error('redirect'), { redirect: opts }),
}))
vi.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: (d: { defaultMessage: string }) => d.defaultMessage }),
}))
vi.mock('@heroicons/react/24/outline', () => ({ RssIcon: () => <svg data-testid="rss" /> }))
vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/shared/page-header', () => ({
  PageHeader: ({ title, action }: { title: ReactNode; action: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {action}
    </div>
  ),
}))
vi.mock('@/components/portal/changelog', () => ({
  ChangelogListPublic: (props: {
    onCategoryChange: (id: string) => void
    onProductChange: (id: string) => void
  }) => (
    <div data-testid="list">
      <button type="button" data-testid="cat" onClick={() => props.onCategoryChange('cat_9')}>
        cat
      </button>
      <button type="button" data-testid="prod" onClick={() => props.onProductChange('prod_9')}>
        prod
      </button>
    </div>
  ),
}))
vi.mock('@/lib/server/functions/changelog', () => ({
  getChangelogVisibilityForCurrentUserFn: (...a: unknown[]) => m.visibility(...a),
  listPublicChangelogTaxonomyFn: (...a: unknown[]) => m.taxonomy(...a),
}))

const { Route } = await import('../changelog.index')
type Opts = {
  beforeLoad: (a: { context: unknown }) => Promise<void>
  loader: (a: { context: unknown }) => Promise<Record<string, unknown>>
  component: () => ReactElement
}
const opts = () => (Route as unknown as { options: Opts }).options

beforeEach(() => {
  vi.clearAllMocks()
  m.visibility.mockResolvedValue({ allowedCategoryIds: ['c1'], allowedProductIds: ['p1'] })
  m.taxonomy.mockResolvedValue({ categories: [], products: [] })
  routeData.useLoaderData.mockReturnValue({
    visibility: { allowedCategoryIds: ['c1'], allowedProductIds: ['p1'] },
    taxonomy: { categories: [], products: [] },
  })
  routeData.useSearch.mockReturnValue({ category: undefined, product: undefined })
  routeData.useNavigate.mockReturnValue(vi.fn())
})

describe('beforeLoad gate', () => {
  it('redirects when the changelog tab is disabled', async () => {
    await expect(
      opts().beforeLoad({ context: { enabledTabs: { changelog: false } } })
    ).rejects.toThrow('redirect')
  })
  it('passes when enabled or unset', async () => {
    await expect(opts().beforeLoad({ context: { enabledTabs: {} } })).resolves.toBeUndefined()
  })
})

describe('loader', () => {
  it('fetches visibility + taxonomy and applies context fallbacks', async () => {
    const data = await opts().loader({ context: {} })
    expect(data.workspaceName).toBe('Quackback')
    expect(data.baseUrl).toBe('')
    expect(m.visibility).toHaveBeenCalled()
    const data2 = await opts().loader({
      context: { settings: { name: 'Acme' }, baseUrl: 'https://a.test' },
    })
    expect(data2.workspaceName).toBe('Acme')
  })
})

describe('component', () => {
  it('renders and wires the category/product navigate callbacks', () => {
    const navigate = vi.fn()
    routeData.useNavigate.mockReturnValue(navigate)
    const Page = opts().component
    render(<Page />)
    expect(screen.getByTestId('list')).toBeInTheDocument()
    act(() => screen.getByTestId('cat').click())
    act(() => screen.getByTestId('prod').click())
    expect(navigate).toHaveBeenCalledTimes(2)
    // exercise the search updater functions passed to navigate
    const updater = navigate.mock.calls[0][0].search as (p: Record<string, unknown>) => unknown
    expect(updater({ product: 'x' })).toMatchObject({ category: 'cat_9', product: 'x' })
    const updater2 = navigate.mock.calls[1][0].search as (p: Record<string, unknown>) => unknown
    expect(updater2({ category: 'y' })).toMatchObject({ category: 'y', product: 'prod_9' })
  })
})
