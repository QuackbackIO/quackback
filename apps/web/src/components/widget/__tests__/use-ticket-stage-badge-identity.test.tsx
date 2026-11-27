// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const auth: { user: { id: string } | null; sessionVersion: number; identityResolved: boolean } = {
  user: { id: 'user_a' },
  sessionVersion: 1,
  identityResolved: true,
}
let tickets: { ticketId: string; stage: { slot: string | null } }[] = []

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    sessionVersion: auth.sessionVersion,
    user: auth.user,
    isIdentified: auth.user !== null,
    identityResolved: auth.identityResolved,
  }),
}))
vi.mock('@/lib/client/widget-auth', () => ({ getWidgetAuthHeaders: () => ({}) }))
vi.mock('@/lib/server/functions/widget/tickets', () => ({
  widgetGetMyTicketsFn: () => Promise.resolve({ tickets }),
}))

import { useTicketStageBadge } from '../use-ticket-stage-badge'

beforeEach(() => {
  localStorage.clear()
  auth.user = { id: 'user_a' }
  auth.sessionVersion = 1
  auth.identityResolved = true
})

it('a second person signed in on the same browser gets their own stage badges', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )

  // Person A has used the widget: their first load stamps a baseline.
  tickets = [{ ticketId: 'tkt_a', stage: { slot: 'open' } }]
  const a = renderHook(() => useTicketStageBadge(true), { wrapper })
  await waitFor(() => expect(qc.getQueryData(['widget', 'myTickets', 1])).toBeDefined())
  a.unmount()

  // The host signs A out and identifies B in the same browser.
  auth.user = { id: 'user_b' }
  auth.sessionVersion = 2
  tickets = [{ ticketId: 'tkt_b', stage: { slot: 'open' } }]
  const b = renderHook(() => useTicketStageBadge(true), { wrapper })
  await waitFor(() => expect(qc.getQueryData(['widget', 'myTickets', 2])).toBeDefined())
  expect(b.result.current.unread).toBe(0)

  // An agent moves B's ticket: B's badge counts it.
  tickets = [{ ticketId: 'tkt_b', stage: { slot: 'resolved' } }]
  await act(() => qc.invalidateQueries({ queryKey: ['widget', 'myTickets', 2] }))
  await waitFor(() => expect(b.result.current.unread).toBe(1))
})

it("an anonymous identify neither counts nor stamps the last person's cached tickets", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  localStorage.setItem('quackback:ticket-stages-seen:user_a', JSON.stringify({ tkt_a: 'open' }))
  tickets = [{ ticketId: 'tkt_a', stage: { slot: 'resolved' } }]
  const hook = renderHook(() => useTicketStageBadge(true), { wrapper })
  await waitFor(() => expect(hook.result.current.unread).toBe(1))

  // The host switches to anonymous: the same query key keeps A's tickets.
  auth.user = null
  hook.rerender()
  expect(hook.result.current.unread).toBe(0)
  expect(localStorage.getItem('quackback:ticket-stages-seen:anonymous')).toBeNull()
})

it('counts and writes nothing until the identity round trip settles', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  localStorage.setItem('quackback:ticket-stages-seen:user_a', JSON.stringify({ tkt_a: 'open' }))
  tickets = [{ ticketId: 'tkt_a', stage: { slot: 'resolved' } }]
  auth.identityResolved = false
  const hook = renderHook(() => useTicketStageBadge(true), { wrapper })
  await waitFor(() => expect(qc.getQueryData(['widget', 'myTickets', 1])).toBeDefined())
  expect(hook.result.current.unread).toBe(0)
  expect(localStorage.getItem('quackback:ticket-stages-seen:anonymous')).toBeNull()

  // Settled as person A: their map applies, and the moved stage badges.
  auth.identityResolved = true
  hook.rerender()
  await waitFor(() => expect(hook.result.current.unread).toBe(1))
})

it('ignores a map saved before maps were kept per person', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  localStorage.setItem('quackback:ticket-stages-seen', JSON.stringify({ tkt_a: 'open' }))
  tickets = [{ ticketId: 'tkt_a', stage: { slot: 'resolved' } }]
  const hook = renderHook(() => useTicketStageBadge(true), { wrapper })
  // Person A starts from their own silent baseline; the shared key is gone.
  await waitFor(() =>
    expect(JSON.parse(localStorage.getItem('quackback:ticket-stages-seen:user_a')!)).toEqual({
      tkt_a: 'resolved',
    })
  )
  expect(localStorage.getItem('quackback:ticket-stages-seen')).toBeNull()
  expect(hook.result.current.unread).toBe(0)
})

it('reads the map once, not on every render', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  localStorage.setItem('quackback:ticket-stages-seen:user_a', JSON.stringify({ tkt_a: 'open' }))
  tickets = [{ ticketId: 'tkt_a', stage: { slot: 'open' } }]
  const hook = renderHook(() => useTicketStageBadge(true), { wrapper })
  await waitFor(() => expect(qc.getQueryData(['widget', 'myTickets', 1])).toBeDefined())
  const getItem = vi.spyOn(window.localStorage, 'getItem')
  hook.rerender()
  hook.rerender()
  expect(getItem).not.toHaveBeenCalled()
  getItem.mockRestore()
})
