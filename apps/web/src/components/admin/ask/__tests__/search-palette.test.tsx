// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import messages from '@/locales/en.json'

const state = vi.hoisted(() => ({
  pathname: '/admin',
  navigations: [] as string[],
  searches: [] as string[],
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    navigate: ({ href }: { href: string }) => {
      state.navigations.push(href)
    },
  }),
  useRouterState: ({ select }: { select: (value: unknown) => unknown }) =>
    select({ location: { pathname: state.pathname } }),
}))
vi.mock('@/lib/client/use-permissions', () => ({
  usePermissions: () => new Set(['settings.manage', 'post.view_private']),
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  usePrincipalId: () => 'owner-acme',
  useFeatureFlags: () => ({ feedback: true }),
  useBillingEnabled: () => false,
  useCloudEnabled: () => false,
}))
vi.mock('@/lib/server/functions/ask-search', () => ({
  searchAskEntitiesFn: async ({ data }: { data: { query: string } }) => {
    state.searches.push(data.query)
    return data.query === 'refund'
      ? [{ id: 'post_refund', title: 'Refund policy idea', href: '/admin/feedback?post=refund' }]
      : []
  },
}))

import { SearchPaletteProvider, SearchTrigger } from '../search-palette'
// The dialog loads on first open; load it once up front so tests time behaviour, not transforms.
await import('../search-palette-dialog')

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={messages}>
        <SearchPaletteProvider>
          <SearchTrigger tour />
          <SearchTrigger />
        </SearchPaletteProvider>
      </IntlProvider>
    </QueryClientProvider>
  )
}
const palette = () => screen.queryByRole('combobox', { name: 'Search Quackback' })

beforeEach(() => {
  state.pathname = '/admin'
  state.navigations = []
  state.searches = []
})
afterEach(cleanup)

it('searches pages and entities with no AI and never asks Copilot', async () => {
  mount()
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  const input = await screen.findByRole('combobox', { name: 'Search Quackback' })
  fireEvent.change(input, { target: { value: 'refund' } })
  fireEvent.click(await screen.findByRole('option', { name: /Refund policy idea/ }))
  expect(state.navigations).toEqual(['/admin/feedback?post=refund'])
  expect(state.searches).toEqual(['refund'])
  expect(screen.queryByText(/Copilot/)).toBeNull()
})

it('toggles with Ctrl+K and opens from the Search row', async () => {
  mount()
  fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[0]!)
  expect(await screen.findByRole('combobox', { name: 'Search Quackback' })).toBeTruthy()
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  await waitFor(() => expect(palette()).toBeNull())
})

it('leaves Ctrl+K to a handler that already took it, and to the Inbox command bar', async () => {
  mount()
  const taken = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true })
  taken.preventDefault()
  act(() => {
    window.dispatchEvent(taken)
  })
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
  expect(palette()).toBeNull()
  cleanup()
  state.pathname = '/admin/inbox'
  mount()
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
  expect(palette()).toBeNull()
  fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[0]!)
  expect(await screen.findByRole('combobox', { name: 'Search Quackback' })).toBeTruthy()
})

it('marks only the sidebar row as the tour stop', () => {
  const view = mount()
  expect(view.container.querySelectorAll('[data-tour="search"]')).toHaveLength(1)
  expect(screen.getAllByText('Ctrl K')).toHaveLength(2)
})
