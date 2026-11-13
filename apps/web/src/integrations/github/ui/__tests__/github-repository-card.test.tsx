// @vitest-environment happy-dom
/**
 * One repository's card: its state badges, whether a webhook is registered,
 * the last delivery, the recorded error, a repair that reports its outcome,
 * the on/off switch, what its issues open in the inbox (with the team and
 * ticket type of its tickets), the assignee switch, the replies-as-comments
 * switch with its visibility warning, the ticket opt-in with
 * its team and type filters, and removal behind a confirmation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { IntegrationDestinationSummary } from '@/lib/server/functions/integration-destinations'

const mocks = vi.hoisted(() => ({
  repair: vi.fn(),
  remove: vi.fn(),
  setEnabled: vi.fn(),
  setConfig: vi.fn(),
  setTicketIssues: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/client/mutations', () => ({
  useReconnectIntegrationDestination: () => ({ mutate: mocks.repair, isPending: false }),
  useRemoveIntegrationDestination: () => ({ mutateAsync: mocks.remove, isPending: false }),
  useSetIntegrationDestinationEnabled: () => ({ mutate: mocks.setEnabled, isPending: false }),
  useSetIntegrationDestinationConfig: () => ({ mutate: mocks.setConfig, isPending: false }),
  useSetIntegrationDestinationTicketIssues: () => ({
    mutate: mocks.setTicketIssues,
    isPending: false,
  }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }))

import { GitHubRepositoryCard } from '../github-repository-card'
import { inboxTeamsQueryOptions } from '@/lib/client/queries/inbox-teams'
import { ticketQueries } from '@/lib/client/queries/inbox'

const repo: IntegrationDestinationSummary = {
  id: 'integration_destination_1',
  kind: 'repo',
  externalId: 'acme/app',
  enabled: true,
  direction: 'both',
  inboundMode: 'off',
  ticketScope: { teamId: null, ticketTypeId: null },
  assigneeSync: false,
  postRepliesAsComments: false,
  ticketIssues: { enabled: false, teamIds: [], ticketTypeIds: [] },
  isDefault: false,
  webhookRegistered: true,
  webhookEvents: ['issues'],
  lastError: null,
  lastErrorAt: null,
  lastInboundAt: null,
}

function renderCard(destination: IntegrationDestinationSummary, inboxOff = false) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(inboxTeamsQueryOptions().queryKey, [
    { id: 'team_billing', name: 'Billing', icon: null, color: 'gray', memberCount: 2 },
  ] as never)
  client.setQueryData(ticketQueries.types().queryKey, [
    { id: 'ticket_type_question', name: 'Question', category: 'customer', icon: null },
    { id: 'ticket_type_task', name: 'Task', category: 'back_office', icon: null },
  ] as never)
  render(
    <IntlProvider locale="en" messages={{}}>
      <QueryClientProvider client={client}>
        <GitHubRepositoryCard destination={destination} inboxOff={inboxOff} />
      </QueryClientProvider>
    </IntlProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // Radix Select measures and captures pointers, which happy-dom does not.
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
})
afterEach(cleanup)

describe('GitHubRepositoryCard', () => {
  it('shows an active repository with its webhook and no deliveries yet', () => {
    renderCard(repo)
    expect(screen.getByText('acme/app')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.queryByText('Default')).toBeNull()
    expect(screen.getByText('Webhook registered')).toBeTruthy()
    expect(screen.getByText('No deliveries received yet')).toBeTruthy()
  })

  it('marks the default repository', () => {
    renderCard({ ...repo, isDefault: true })
    expect(screen.getByText('Default')).toBeTruthy()
  })

  it('shows the recorded error and a missing webhook', () => {
    renderCard({
      ...repo,
      webhookRegistered: false,
      lastError: 'Failed to register webhook: Must have admin rights',
    })
    expect(screen.getByText('Error')).toBeTruthy()
    expect(screen.getByText('No webhook')).toBeTruthy()
    expect(screen.getByText('Failed to register webhook: Must have admin rights')).toBeTruthy()
  })

  it('shows a switched-off repository as paused and when it last delivered', () => {
    renderCard({ ...repo, enabled: false, lastInboundAt: new Date().toISOString() })
    expect(screen.getByText('Paused')).toBeTruthy()
    expect(screen.getByText(/^Last delivery received/)).toBeTruthy()
  })

  it('repairs the webhook and reports the outcome', () => {
    renderCard(repo)
    fireEvent.click(screen.getByRole('button', { name: 'Repair webhook' }))

    const [destinationId, opts] = mocks.repair.mock.calls[0]
    expect(destinationId).toBe('integration_destination_1')
    opts.onSuccess()
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Webhook repaired')
    opts.onError()
    expect(mocks.toastError).toHaveBeenCalledWith('Could not repair the webhook')
  })

  it('switches the repository off', () => {
    renderCard(repo)
    fireEvent.click(screen.getByRole('switch', { name: 'Sync acme/app' }))
    expect(mocks.setEnabled.mock.calls[0][0]).toEqual({
      destinationId: 'integration_destination_1',
      enabled: false,
    })
  })

  it('switches issue assignees on, but not for a send-only repository', () => {
    renderCard(repo)
    const name = 'Follow issue assignees from acme/app onto tickets'
    fireEvent.click(screen.getByRole('switch', { name }))
    expect(mocks.setConfig.mock.calls[0][0]).toEqual({
      destinationId: 'integration_destination_1',
      config: { assigneeSync: true },
    })
    cleanup()
    renderCard({ ...repo, direction: 'outbound' })
    expect(screen.getByRole('switch', { name })).toBeDisabled()
  })

  it('posts replies as comments, warns they become visible, never for a receive-only repository', () => {
    renderCard(repo)
    const name = 'Post ticket replies as comments on linked issues in acme/app'
    const warning = /are posted to the issue and visible to anyone who can see it/
    expect(screen.queryByText(warning)).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name }))
    expect(mocks.setConfig.mock.calls[0][0]).toEqual({
      destinationId: 'integration_destination_1',
      config: { postRepliesAsComments: true },
    })
    cleanup()
    renderCard({ ...repo, postRepliesAsComments: true })
    expect(screen.getByRole('switch', { name })).toBeChecked()
    expect(screen.getByText(warning)).toBeTruthy()
    cleanup()
    renderCard({ ...repo, direction: 'inbound' })
    expect(screen.getByRole('switch', { name })).toBeDisabled()
  })

  it('brings the repository into the inbox as conversations or tickets', async () => {
    renderCard(repo)
    const mode = screen.getByRole('combobox', {
      name: 'What issues from acme/app open in the inbox',
    })
    expect(mode).toHaveTextContent('Off')
    expect(screen.queryByRole('combobox', { name: 'Team for tickets from acme/app' })).toBeNull()

    await userEvent.click(mode)
    await userEvent.click(screen.getByRole('option', { name: 'Tickets' }))
    expect(mocks.setConfig.mock.calls[0][0]).toEqual({
      destinationId: 'integration_destination_1',
      config: { inboundMode: 'tickets' },
    })
  })

  it('says when the inbox channel is off for a repository that brings issues in', () => {
    renderCard({ ...repo, inboundMode: 'tickets' }, true)
    expect(screen.getByText(/The GitHub inbox channel is off/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Turn it on' }).getAttribute('href')).toBe(
      '/admin/settings/channels/github'
    )
    cleanup()

    renderCard(repo, true)
    expect(screen.queryByText(/The GitHub inbox channel is off/)).toBeNull()
    cleanup()

    renderCard({ ...repo, inboundMode: 'conversations' })
    expect(screen.queryByText(/The GitHub inbox channel is off/)).toBeNull()
  })

  it('chooses the team and customer ticket type of its tickets', async () => {
    renderCard({ ...repo, inboundMode: 'tickets' })
    const team = screen.getByRole('combobox', { name: 'Team for tickets from acme/app' })
    expect(team).toHaveTextContent('No team')
    await userEvent.click(team)
    await userEvent.click(screen.getByRole('option', { name: 'Billing' }))
    expect(mocks.setConfig.mock.calls[0][0]).toEqual({
      destinationId: 'integration_destination_1',
      config: {
        inboundMode: 'tickets',
        ticketScope: { teamId: 'team_billing', ticketTypeId: null },
      },
    })

    const type = screen.getByRole('combobox', { name: 'Ticket type for tickets from acme/app' })
    expect(type).toHaveTextContent('Default ticket type')
    await userEvent.click(type)
    expect(screen.queryByRole('option', { name: 'Task' })).toBeNull()
    await userEvent.click(screen.getByRole('option', { name: 'Question' }))
    expect(mocks.setConfig.mock.calls[1][0].config.ticketScope).toEqual({
      teamId: null,
      ticketTypeId: 'ticket_type_question',
    })
  })

  it('switches on an issue for each new ticket, but not for a receive-only repository', () => {
    renderCard(repo)
    const name = 'Create an issue in acme/app for each new ticket it matches'
    expect(screen.queryByRole('button', { name: /Teams whose tickets/ })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name }))
    const [input, opts] = mocks.setTicketIssues.mock.calls[0]
    expect(input).toEqual({
      destinationId: 'integration_destination_1',
      enabled: true,
      teamIds: [],
      ticketTypeIds: [],
    })
    opts.onError()
    expect(mocks.toastError).toHaveBeenCalledWith('Could not save the repository settings')
    cleanup()
    renderCard({ ...repo, direction: 'inbound' })
    expect(screen.getByRole('switch', { name })).toBeDisabled()
  })

  it('narrows the tickets that get an issue by team and by ticket type', async () => {
    renderCard({
      ...repo,
      ticketIssues: { enabled: true, teamIds: [], ticketTypeIds: ['ticket_type_task'] },
    })
    expect(screen.getByText(/Applies to tickets opened from now on/)).toBeTruthy()
    const teamsButton = screen.getByRole('button', {
      name: 'Teams whose tickets get an issue in acme/app',
    })
    expect(teamsButton).toHaveTextContent('All teams')
    const typesButton = screen.getByRole('button', {
      name: 'Ticket types that get an issue in acme/app',
    })
    // Any ticket type may be chosen, not only customer ones.
    expect(typesButton).toHaveTextContent('Task')

    await userEvent.click(teamsButton)
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Billing' }))
    expect(mocks.setTicketIssues.mock.calls[0][0]).toEqual({
      destinationId: 'integration_destination_1',
      enabled: true,
      teamIds: ['team_billing'],
      ticketTypeIds: ['ticket_type_task'],
    })
  })

  it('removes the repository only after confirming', async () => {
    mocks.remove.mockResolvedValue({ unlinkedTickets: 0, unlinkedPosts: 0 })
    renderCard(repo)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(await screen.findByText('Stop syncing acme/app?')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Remove repository' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('integration_destination_1'))
  })

  it('reports a removal that failed', async () => {
    mocks.remove.mockRejectedValue(new Error('nope'))
    renderCard(repo)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove repository' }))
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('Could not remove the repository')
    )
  })
})
