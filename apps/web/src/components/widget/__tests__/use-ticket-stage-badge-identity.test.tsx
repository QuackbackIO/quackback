// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const auth = { user: { id: 'user_a' }, sessionVersion: 1 }
let tickets: { ticketId: string; stage: { slot: string | null } }[] = []

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    sessionVersion: auth.sessionVersion,
    user: auth.user,
    isIdentified: true,
    identityResolved: true,
  }),
}))
vi.mock('@/lib/client/widget-auth', () => ({ getWidgetAuthHeaders: () => ({}) }))
vi.mock('@/lib/server/functions/widget/tickets', () => ({
  widgetGetMyTicketsFn: () => Promise.resolve({ tickets }),
}))

import { useTicketStageBadge } from '../use-ticket-stage-badge'

beforeEach(() => localStorage.clear())

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
