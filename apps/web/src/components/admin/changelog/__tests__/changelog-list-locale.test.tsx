// @vitest-environment happy-dom
/**
 * The admin changelog list speaks the viewer's language: its heading is the
 * word the sidebar uses, and its filters, search, sort and New entry button
 * are translated, with no English left over.
 */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'react-intl'
import de from '@/locales/de.json'

vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: () => ({
    data: { pages: [{ items: [] }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
  }),
  useMutation: () => ({ mutate: vi.fn() }),
  useQueryClient: () => ({}),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/routes/admin/changelog', () => ({
  Route: { fullPath: '/admin/changelog', useSearch: () => ({}) },
}))
vi.mock('@/lib/client/queries/changelog', () => ({
  changelogQueries: { list: (params: unknown) => ({ queryKey: ['changelog-list', params] }) },
}))
vi.mock('@/lib/client/mutations/changelog', () => ({
  useDeleteChangelog: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/lib/client/hooks/use-infinite-scroll', () => ({ useInfiniteScroll: () => vi.fn() }))
vi.mock('@/components/admin/feedback/inbox-layout', () => ({
  InboxLayout: (props: {
    headerTitle: string
    filters: React.ReactNode
    children: React.ReactNode
  }) => (
    <div>
      <h2>{props.headerTitle}</h2>
      {props.filters}
      {props.children}
    </div>
  ),
}))
vi.mock('../changelog-top-viewed', () => ({ ChangelogTopViewed: () => null }))

import { ChangelogList } from '../changelog-list'

afterEach(cleanup)

it('renders the list in German, headed by the sidebar word', async () => {
  render(
    <IntlProvider locale="de" defaultLocale="en" messages={de} onError={() => {}}>
      <ChangelogList />
    </IntlProvider>
  )
  expect(screen.getByRole('heading', { name: de['admin.nav.changelog'] })).toBeTruthy()
  expect(screen.getByPlaceholderText('Einträge durchsuchen …')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Neuer Eintrag' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Sortieren: Neueste/ })).toBeTruthy()
  for (const status of ['Alle', 'Entwurf', 'Geplant', 'Veröffentlicht']) {
    expect(screen.getByText(status)).toBeTruthy()
  }
  await userEvent.setup().click(screen.getByRole('button', { name: 'Filtern' }))
  expect(screen.getAllByRole('button', { name: 'Geplant' }).length).toBeGreaterThan(0)
  const text = document.body.textContent ?? ''
  for (const english of ['Changelog', 'New entry', 'Sort:', 'Draft', 'Scheduled', 'Published']) {
    expect(text).not.toContain(english)
  }
})
