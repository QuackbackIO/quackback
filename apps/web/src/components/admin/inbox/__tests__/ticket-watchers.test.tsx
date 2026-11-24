// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PrincipalId, TicketId } from '@quackback/ids'

// ticketQueries imports the whole ticket fn module; stub it so no server code loads.
vi.mock('@/lib/server/functions/tickets', () => ({}))
vi.mock('@/lib/client/mutations/inbox', () => {
  const idle = () => ({ mutate: vi.fn(), isPending: false })
  return {
    useSetTicketStatus: idle,
    useAssignTicket: idle,
    useSetTicketPriority: idle,
    useWatchTicket: idle,
    useUnwatchTicket: idle,
    useMuteTicket: idle,
    useUnmuteTicket: idle,
    useAdminAddTicketWatcher: idle,
    useAdminRemoveTicketWatcher: idle,
  }
})
vi.mock('@/lib/client/hooks/use-team-members', () => ({
  useTeamMembers: () => ({ data: [] }),
}))

import { TicketWatchControl } from '../ticket-controls'
import { ticketKeys } from '@/lib/client/queries/inbox'

const TICKET = 'ticket_1' as TicketId

function watcher(id: string, displayName: string) {
  return {
    principalId: id as PrincipalId,
    reason: 'manual' as const,
    mutedUntil: null,
    displayName,
    avatarUrl: null,
    role: 'member',
  }
}

afterEach(cleanup)

describe('TicketWatchControl watcher stack', () => {
  it('sets the avatars side by side so no avatar covers the initials of another', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(ticketKeys.watch(TICKET), { watching: true, mutedUntil: null })
    qc.setQueryData(ticketKeys.watchers(TICKET), [
      watcher('principal_1', 'Dana Ivers'),
      watcher('principal_2', 'Cole Chen'),
      watcher('principal_3', 'Dev Ortiz'),
    ])
    render(
      <QueryClientProvider client={qc}>
        <TicketWatchControl ticketId={TICKET} />
      </QueryClientProvider>
    )

    const stack = screen.getByRole('button', { name: 'Manage watchers' })
    expect([...stack.children].map((a) => a.textContent)).toEqual(['DI', 'CC', 'DO'])
    // Any negative spacing lets each 24px avatar (and its ring) paint over the
    // second letter of the one before it, so the stack must not overlap.
    expect(stack.className).not.toMatch(/(^|\s)-space-x-/)
  })
})
