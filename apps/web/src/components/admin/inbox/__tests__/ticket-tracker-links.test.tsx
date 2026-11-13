// @vitest-environment happy-dom
/**
 * The ticket panel's tracker section: with several repositories, creating an
 * issue asks which one; with one, it creates in it directly.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TicketId } from '@quackback/ids'

const create = vi.hoisted(() => vi.fn())
// ticketQueries imports the whole ticket fn module; stub it so no server code loads.
vi.mock('@/lib/server/functions/tickets', () => ({
  fetchTicketExternalLinksFn: vi.fn(),
  createTicketIssueFn: create,
  linkTicketIssueFn: vi.fn(),
  unlinkTicketIssueFn: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), message: vi.fn() } }))

import { TicketTrackerLinks } from '../ticket-tracker-links'
import { ticketKeys } from '@/lib/client/queries/inbox'

const ticketId = 'ticket_1' as TicketId

function renderSection(destinations: { id: string; name: string }[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(ticketKeys.externalLinks(ticketId), {
    links: [],
    trackers: [
      { integrationType: 'github', name: 'GitHub', canLink: false, canCreate: true, destinations },
    ],
  })
  render(
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={{}}>
        <TicketTrackerLinks ticketId={ticketId} onChanged={vi.fn()} />
      </IntlProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  create.mockReset()
  create.mockResolvedValue({ operationId: 'op', state: 'queued' })
})
afterEach(cleanup)

describe('TicketTrackerLinks', () => {
  it('asks which repository to create the issue in when there are several', async () => {
    renderSection([
      { id: 'dest_app', name: 'acme/app' },
      { id: 'dest_api', name: 'acme/api' },
    ])
    fireEvent.click(screen.getByRole('button', { name: /Add issue/ }))
    fireEvent.click(await screen.findByText('Create issue in acme/api'))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        data: { ticketId, integrationType: 'github', destinationId: 'dest_api' },
      })
    )
  })

  it('creates directly when there is only one repository', async () => {
    renderSection([{ id: 'dest_app', name: 'acme/app' }])
    fireEvent.click(screen.getByRole('button', { name: /Create issue/ }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        data: { ticketId, integrationType: 'github', destinationId: undefined },
      })
    )
  })
})
