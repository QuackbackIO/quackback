// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const auth: { user: { id: string } | null; identityResolved: boolean } = {
  user: { id: 'user_a' },
  identityResolved: false,
}

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    sessionVersion: 1,
    user: auth.user,
    isIdentified: auth.user !== null,
    identityResolved: auth.identityResolved,
  }),
}))
vi.mock('@/lib/client/widget-auth', () => ({ getWidgetAuthHeaders: () => ({}) }))
vi.mock('@/lib/server/functions/widget/tickets', () => ({
  widgetGetMyTicketsFn: () =>
    Promise.resolve({
      tickets: [
        {
          ticketId: 'tkt_1',
          reference: '#1',
          title: 'Ticket 1',
          stage: { slot: 'resolved', label: 'Resolved', closed: false },
          conversationId: 'cnv_1',
          updatedAt: '2026-11-25T10:00:00Z',
        },
      ],
    }),
}))
vi.mock('@/lib/server/functions/widget/changelog', () => ({
  widgetListPublicChangelogsFn: () =>
    Promise.resolve({
      items: [
        {
          id: 'changelog_1',
          title: 'Entry 1',
          content: 'Body',
          publishedAt: '2026-11-25T10:00:00.000Z',
          categories: [],
        },
      ],
      nextCursor: null,
    }),
  widgetListChangelogCategoriesFn: () => Promise.resolve([]),
}))

import { WidgetTickets } from '../widget-tickets'
import { WidgetChangelog } from '../widget-changelog'

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={{}}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
  return { wrapper }
}

function storedKeys(prefix: string): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)!)
  return keys.filter((k) => k.startsWith(prefix))
}

beforeEach(() => {
  localStorage.clear()
  auth.user = { id: 'user_a' }
  auth.identityResolved = false
})

it('the Tickets tab marks nothing seen until the identity round trip settles', async () => {
  localStorage.setItem('quackback:ticket-stages-seen:user_a', JSON.stringify({ tkt_1: 'open' }))
  const { wrapper } = setup()
  const view = render(<WidgetTickets onOpenTicket={() => {}} />, { wrapper })
  await screen.findByText('Ticket 1')
  expect(storedKeys('quackback:ticket-stages-seen')).toEqual([
    'quackback:ticket-stages-seen:user_a',
  ])
  expect(JSON.parse(localStorage.getItem('quackback:ticket-stages-seen:user_a')!)).toEqual({
    tkt_1: 'open',
  })

  // Settled as person A: their changed row is pointed out, then marked seen.
  auth.identityResolved = true
  view.rerender(<WidgetTickets onOpenTicket={() => {}} />)
  expect(screen.getByText('Status changed since your last visit')).toBeTruthy()
  await waitFor(() =>
    expect(JSON.parse(localStorage.getItem('quackback:ticket-stages-seen:user_a')!)).toEqual({
      tkt_1: 'resolved',
    })
  )
})

it("an anonymous visitor never marks the last person's cached tickets seen", async () => {
  auth.user = null
  auth.identityResolved = true
  const { wrapper } = setup()
  render(<WidgetTickets onOpenTicket={() => {}} />, { wrapper })
  await screen.findByText('Ticket 1')
  expect(storedKeys('quackback:ticket-stages-seen')).toEqual([])
})

it('the Changelog tab marks nothing seen until the identity round trip settles', async () => {
  localStorage.setItem('quackback:changelog-seen-at:user_a', '2026-11-01T00:00:00.000Z')
  const { wrapper } = setup()
  const view = render(<WidgetChangelog />, { wrapper })
  await screen.findByText('Entry 1')
  expect(storedKeys('quackback:changelog-seen-at')).toEqual(['quackback:changelog-seen-at:user_a'])
  expect(localStorage.getItem('quackback:changelog-seen-at:user_a')).toBe(
    '2026-11-01T00:00:00.000Z'
  )

  // Settled as person A: the entry is new to them, then marked seen.
  auth.identityResolved = true
  view.rerender(<WidgetChangelog />)
  expect(screen.getByText('New')).toBeTruthy()
  await waitFor(() =>
    expect(localStorage.getItem('quackback:changelog-seen-at:user_a')).toBe(
      '2026-11-25T10:00:00.000Z'
    )
  )
})

it('the Changelog tab keeps each person\'s "New" labels across a switch and back', async () => {
  localStorage.setItem('quackback:changelog-seen-at:user_c', '2026-11-01T00:00:00.000Z')
  auth.user = { id: 'user_c' }
  auth.identityResolved = true
  const { wrapper } = setup()
  const view = render(<WidgetChangelog />, { wrapper })
  await screen.findByText('Entry 1')
  expect(screen.getByText('New')).toBeTruthy()
  // Having the list on screen marks the entry seen for person C.
  await waitFor(() =>
    expect(localStorage.getItem('quackback:changelog-seen-at:user_c')).toBe(
      '2026-11-25T10:00:00.000Z'
    )
  )

  // Another person signs in on this frame, then C again, within one visit.
  auth.user = { id: 'user_d' }
  view.rerender(<WidgetChangelog />)
  auth.user = { id: 'user_c' }
  view.rerender(<WidgetChangelog />)
  expect(screen.getByText('New')).toBeTruthy()
})
