// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const hoisted = vi.hoisted(() => ({
  search: { current: {} as Record<string, unknown> },
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useSearch: () => hoisted.search.current,
  }),
  useNavigate: () => hoisted.navigate,
  useSearch: () => hoisted.search.current,
  Link: ({ children }: { children: unknown }) => <a>{children as never}</a>,
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => ({ featureFlags: {} }),
}))
vi.mock('@/lib/server/functions/analytics', () => ({
  getAnalyticsData: vi.fn(() => new Promise(() => {})),
}))
vi.mock('@/lib/server/functions/visitor-analytics', () => ({
  getVisitorAnalyticsData: vi.fn(() => new Promise(() => {})),
}))

const { Route } = await import('../analytics')
const { AnalyticsPage } = await import('@/components/admin/analytics/analytics-page')

afterEach(() => {
  cleanup()
  hoisted.navigate.mockReset()
})

describe('analytics section search param', () => {
  const validate = (
    Route as unknown as {
      options: { validateSearch: (raw: Record<string, unknown>) => { section?: string } }
    }
  ).options.validateSearch

  it('keeps a valid section and drops an invalid one', () => {
    expect(validate({ section: 'ai' }).section).toBe('ai')
    expect(validate({ section: 'support' }).section).toBe('support')
    expect(validate({ section: 'bogus' }).section).toBeUndefined()
    expect(validate({}).section).toBeUndefined()
  })
})

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <QueryClientProvider client={queryClient}>
        <AnalyticsPage />
      </QueryClientProvider>
    </IntlProvider>
  )
}

describe('AnalyticsPage section from the URL', () => {
  it('opens the section named in the URL', () => {
    hoisted.search.current = { section: 'ai' }
    const { container } = renderPage()
    const active = container.querySelector('[data-side-pane] [data-active]')
    expect(active?.textContent).toBe('Quinn')
  })

  it('opens the overview when the URL names no section', () => {
    hoisted.search.current = {}
    const { container } = renderPage()
    expect(container.querySelector('[data-side-pane] [data-active]')?.textContent).toBe('Overview')
  })

  it('writes the picked section back to the URL', async () => {
    hoisted.search.current = {}
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Users' }))
    await waitFor(() => expect(hoisted.navigate).toHaveBeenCalled())
    const call = hoisted.navigate.mock.calls[0][0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>
    }
    expect(call.search({})).toEqual({ section: 'users' })
  })
})
