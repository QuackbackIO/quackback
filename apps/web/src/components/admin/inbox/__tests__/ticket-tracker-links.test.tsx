// @vitest-environment happy-dom
/**
 * The ticket panel's tracker section: with several repositories, creating an
 * issue asks which one; with one, it creates in it directly. A tracker that
 * mirrors comments offers a sync while an issue is linked, and reports what
 * it queued.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TicketId } from '@quackback/ids'

const create = vi.hoisted(() => vi.fn())
const sync = vi.hoisted(() => vi.fn())
const toastMessage = vi.hoisted(() => vi.fn())
// ticketQueries imports the whole ticket fn module; stub it so no server code loads.
vi.mock('@/lib/server/functions/tickets', () => ({
  fetchTicketExternalLinksFn: vi.fn(),
  createTicketIssueFn: create,
  linkTicketIssueFn: vi.fn(),
  unlinkTicketIssueFn: vi.fn(),
  syncTicketIntegrationsFn: sync,
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), message: toastMessage } }))

import { TicketTrackerLinks } from '../ticket-tracker-links'
import { ticketKeys } from '@/lib/client/queries/inbox'

const ticketId = 'ticket_1' as TicketId

function renderSection(
  destinations: { id: string; name: string }[],
  opts: { canSync?: boolean; links?: unknown[] } = {}
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(ticketKeys.externalLinks(ticketId), {
    links: opts.links ?? [],
    trackers: [
      {
        integrationType: 'github',
        name: 'GitHub',
        canLink: false,
        canCreate: true,
        canSync: opts.canSync ?? false,
        destinations,
      },
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
  sync.mockReset()
  toastMessage.mockReset()
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

  it('syncs the ticket with its linked issues and says what was queued', async () => {
    const link = {
      id: 'ticket_external_link_1',
      integrationType: 'github',
      externalId: '7',
      externalDisplayId: 'acme/app#7',
      externalUrl: 'https://github.com/acme/app/issues/7',
    }
    sync.mockResolvedValue({ inbound: 2, outbound: 1 })
    renderSection([{ id: 'dest_app', name: 'acme/app' }], { canSync: true, links: [link] })
    fireEvent.click(screen.getByRole('button', { name: /Sync with GitHub/ }))
    await waitFor(() => expect(sync).toHaveBeenCalledWith({ data: { ticketId } }))
    await waitFor(() =>
      expect(toastMessage).toHaveBeenCalledWith('Sync with GitHub queued', {
        description: 'Comments to bring in: 2. Replies to post: 1.',
      })
    )
  })

  it('offers no sync without a linked issue or for a tracker that does not mirror comments', () => {
    renderSection([{ id: 'dest_app', name: 'acme/app' }], { canSync: true })
    expect(screen.queryByRole('button', { name: /Sync with/ })).toBeNull()
    cleanup()
    renderSection([{ id: 'dest_app', name: 'acme/app' }], {
      links: [
        {
          id: 'ticket_external_link_1',
          integrationType: 'github',
          externalId: '7',
          externalDisplayId: 'acme/app#7',
          externalUrl: null,
        },
      ],
    })
    expect(screen.queryByRole('button', { name: /Sync with/ })).toBeNull()
  })
})
