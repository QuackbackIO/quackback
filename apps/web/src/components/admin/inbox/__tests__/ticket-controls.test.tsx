// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PrincipalId, TicketId } from '@quackback/ids'
import type { TicketWatcher } from '@/lib/server/domains/tickets/ticket-subscription.service'
import type { TicketWatcherCandidate } from '@/lib/server/domains/tickets/ticket-watchers.service'

// ticketQueries/mutations import the whole ticket fn module; stub it so no server code loads.
vi.mock('@/lib/server/functions/tickets', () => ({
  getTicketWatchStatusFn: vi.fn(),
  listTicketWatchersFn: vi.fn(),
  listTicketWatcherCandidatesFn: vi.fn(),
  watchTicketFn: vi.fn(),
  unwatchTicketFn: vi.fn(),
  muteTicketFn: vi.fn(),
  unmuteTicketFn: vi.fn(),
  adminAddTicketWatcherFn: vi.fn(),
  adminRemoveTicketWatcherFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/admin', () => ({ fetchTeamMembers: vi.fn() }))
const canManage = vi.hoisted(() => ({ value: true }))
vi.mock('@/lib/client/use-permissions', () => ({
  useHasPermission: () => canManage.value,
  usePermissions: () => new Set(),
}))

import { TicketWatchControl } from '../ticket-controls'
import { ticketKeys } from '@/lib/client/queries/inbox'

const TICKET = 'ticket_1' as TicketId

function watcher(overrides: Partial<TicketWatcher>): TicketWatcher {
  return {
    principalId: 'principal_w' as PrincipalId,
    reason: 'manual',
    mutedUntil: null,
    displayName: 'Max Mate',
    avatarUrl: null,
    role: 'member',
    isTeamMember: true,
    ...overrides,
  }
}

function renderControl(watchers: TicketWatcher[], candidates: TicketWatcherCandidate[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(ticketKeys.watch(TICKET), { watching: false, reason: null, mutedUntil: null })
  qc.setQueryData(ticketKeys.watchers(TICKET), watchers)
  qc.setQueryData(ticketKeys.watcherCandidates(TICKET), candidates)
  return render(
    <IntlProvider locale="en" messages={{}}>
      <QueryClientProvider client={qc}>
        <TicketWatchControl ticketId={TICKET} />
      </QueryClientProvider>
    </IntlProvider>
  )
}

describe('TicketWatchControl', () => {
  beforeEach(() => {
    canManage.value = true
  })
  afterEach(cleanup)

  it('lists watchers read-only for a teammate without ticket.assign', () => {
    canManage.value = false
    renderControl([watcher({ reason: 'requester', displayName: 'Rita', isTeamMember: false })])
    fireEvent.click(screen.getByLabelText('See watchers'))
    expect(screen.getByText('Rita')).toBeTruthy()
    expect(screen.getByText('Requester')).toBeTruthy()
    expect(screen.queryByLabelText('Remove watcher')).toBeNull()
    expect(screen.queryByText('Add a teammate')).toBeNull()
  })

  it('shows nothing to add for a teammate without ticket.assign when nobody watches', () => {
    canManage.value = false
    renderControl([])
    expect(screen.queryByText('Add watcher')).toBeNull()
  })

  it('lets a manager remove watchers and add a teammate who can see the ticket', () => {
    renderControl(
      [watcher({})],
      [
        {
          principalId: 'principal_c' as PrincipalId,
          name: 'Cara',
          email: null,
          avatarUrl: null,
          canView: true,
        },
      ]
    )
    fireEvent.click(screen.getByLabelText('Manage watchers'))
    expect(screen.getByLabelText('Remove watcher')).toBeTruthy()
    expect(screen.getByText('Add a teammate')).toBeTruthy()
  })

  it('offers no add when every other teammate is hidden from the ticket', () => {
    renderControl(
      [watcher({})],
      [
        {
          principalId: 'principal_s' as PrincipalId,
          name: 'Sam',
          email: null,
          avatarUrl: null,
          canView: false,
        },
      ]
    )
    fireEvent.click(screen.getByLabelText('Manage watchers'))
    expect(screen.getByText('No more teammates')).toBeTruthy()
  })
})
