// @vitest-environment happy-dom
/**
 * One repository's card: its state badges, whether a webhook is registered,
 * the last delivery, the recorded error, a repair that reports its outcome,
 * the on/off switch, and removal behind a confirmation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { IntegrationDestinationSummary } from '@/lib/server/functions/integration-destinations'

const mocks = vi.hoisted(() => ({
  repair: vi.fn(),
  remove: vi.fn(),
  setEnabled: vi.fn(),
  setConfig: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/client/mutations', () => ({
  useReconnectIntegrationDestination: () => ({ mutate: mocks.repair, isPending: false }),
  useRemoveIntegrationDestination: () => ({ mutateAsync: mocks.remove, isPending: false }),
  useSetIntegrationDestinationEnabled: () => ({ mutate: mocks.setEnabled, isPending: false }),
  useSetIntegrationDestinationConfig: () => ({ mutate: mocks.setConfig, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }))

import { GitHubRepositoryCard } from '../github-repository-card'

const repo: IntegrationDestinationSummary = {
  id: 'integration_destination_1',
  kind: 'repo',
  externalId: 'acme/app',
  enabled: true,
  direction: 'both',
  inboundMode: 'off',
  isDefault: false,
  webhookRegistered: true,
  webhookEvents: ['issues'],
  lastError: null,
  lastErrorAt: null,
  lastInboundAt: null,
}

function renderCard(destination: IntegrationDestinationSummary) {
  render(
    <IntlProvider locale="en" messages={{}}>
      <GitHubRepositoryCard destination={destination} />
    </IntlProvider>
  )
}

beforeEach(() => vi.clearAllMocks())
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

  it('brings the repository into the inbox', () => {
    renderCard(repo)
    fireEvent.click(
      screen.getByRole('switch', { name: 'Bring issues from acme/app into the inbox' })
    )
    expect(mocks.setConfig.mock.calls[0][0]).toEqual({
      destinationId: 'integration_destination_1',
      config: { inboundMode: 'conversations' },
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
