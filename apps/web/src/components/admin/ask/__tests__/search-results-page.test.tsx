// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import messages from '@/locales/en.json'

const state = vi.hoisted(() => ({
  navigations: [] as string[],
  calls: [] as unknown[],
  response: { results: [] as unknown[], hasMore: false },
  fail: false,
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    navigate: ({ href }: { href: string }) => {
      state.navigations.push(href)
    },
  }),
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  usePermissions: () => new Set(['people.view', 'post.view_private']),
  usePrincipalId: () => 'owner-acme',
  useFeatureFlags: () => ({ feedback: true, helpCenter: false, changelog: false }),
}))
vi.mock('@/lib/server/functions/ask-search', () => ({
  searchWorkspaceFn: async ({ data }: { data: unknown }) => {
    state.calls.push(data)
    if (state.fail) throw new Error('down')
    return state.response
  },
}))

import { SearchResultsPage } from '../search-results-page'

function mount(props: { query: string; kind?: 'post' | 'person'; page?: number }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={messages}>
        <SearchResultsPage {...props} />
      </IntlProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  state.navigations = []
  state.calls = []
  state.fail = false
  state.response = {
    hasMore: true,
    results: [
      {
        id: 'principal_1',
        kind: 'person',
        title: 'Refund Rita',
        subtitle: 'rita@acme.io',
        href: '/admin/users?selected=principal_1',
        score: 2,
      },
      {
        id: 'post_1',
        kind: 'post',
        title: 'Faster exports',
        excerpt: 'Customers want a refund when exports fail',
        href: '/admin/feedback?post=post_1',
        score: 0.4,
      },
    ],
  }
})
afterEach(cleanup)

it('lists every kind in one ranked list with excerpts, searching by meaning too', async () => {
  mount({ query: 'refund' })
  const links = await screen.findAllByRole('link')
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    '/admin/users?selected=principal_1',
    '/admin/feedback?post=post_1',
  ])
  expect(links[0].textContent).toContain('Person')
  expect(links[1].textContent).toContain('Customers want a refund when exports fail')
  expect(state.calls).toEqual([
    { query: 'refund', kind: undefined, offset: 0, limit: 20, semantic: true },
  ])
})

it('offers a filter for each kind the viewer may search', async () => {
  mount({ query: 'refund' })
  const filters = screen.getByRole('group', { name: 'Filter by type' })
  const names = [...filters.querySelectorAll('button')].map((button) => button.textContent)
  expect(names).toEqual(['All', 'Posts', 'People'])
  fireEvent.click(screen.getByRole('button', { name: 'People' }))
  expect(state.navigations).toEqual(['/admin/search?q=refund&kind=person'])
})

it('pages forward and back', async () => {
  mount({ query: 'refund', kind: 'post', page: 2 })
  await screen.findAllByRole('link')
  expect(state.calls[0]).toMatchObject({ kind: 'post', offset: 20 })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
  expect(state.navigations).toEqual([
    '/admin/search?q=refund&kind=post&page=3',
    '/admin/search?q=refund&kind=post',
  ])
})

it('searches again from its own box', () => {
  mount({ query: 'refund' })
  const box = screen.getByRole('searchbox', { name: 'Search Quackback' })
  fireEvent.change(box, { target: { value: 'invoice' } })
  fireEvent.submit(box.closest('form')!)
  expect(state.navigations).toEqual(['/admin/search?q=invoice'])
})

it('stays quiet with nothing to show, and offers a retry when search fails', async () => {
  state.response = { results: [], hasMore: false }
  mount({ query: 'zebra' })
  expect(await screen.findByText('No results for “zebra”')).toBeTruthy()
  cleanup()
  state.fail = true
  mount({ query: 'zebra' })
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
})

it('asks for two characters before searching', () => {
  mount({ query: 'r' })
  expect(screen.getByText('Type at least two characters.')).toBeTruthy()
  expect(state.calls).toEqual([])
})

it('puts focus in its search box when the page opens', () => {
  mount({ query: 'refund' })
  expect(document.activeElement).toBe(screen.getByRole('searchbox'))
})
