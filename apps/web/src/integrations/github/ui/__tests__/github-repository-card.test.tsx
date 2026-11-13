// @vitest-environment happy-dom
/**
 * The selected repository's webhook card: its state badge, whether a webhook
 * is registered, the last delivery, the recorded error, and a repair that
 * reports its outcome in a toast.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { IntegrationDestinationSummary } from '@/lib/server/functions/integration-destinations'

const mocks = vi.hoisted(() => ({
  destinations: vi.fn(),
  mutate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    integrationDestinations: (type: string) => ({
      queryKey: ['admin', 'integrations', type, 'destinations'],
      queryFn: mocks.destinations,
    }),
  },
}))
vi.mock('@/lib/client/mutations', () => ({
  useReconnectIntegrationDestination: () => ({ mutate: mocks.mutate, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }))

import { GitHubRepositoryCard } from '../github-repository-card'

const repo: IntegrationDestinationSummary = {
  id: 'integration_destination_1',
  kind: 'repo',
  externalId: 'acme/app',
  enabled: true,
  webhookRegistered: true,
  webhookEvents: ['issues'],
  lastError: null,
  lastErrorAt: null,
  lastInboundAt: null,
}

function renderCard(destinations: IntegrationDestinationSummary[], repository = 'Acme/App') {
  mocks.destinations.mockResolvedValue(destinations)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={{}}>
        <GitHubRepositoryCard repository={repository} />
      </IntlProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('GitHubRepositoryCard', () => {
  it('shows an active repository with its webhook and no deliveries yet', async () => {
    renderCard([repo])
    expect(await screen.findByText('acme/app')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('Webhook registered')).toBeTruthy()
    expect(screen.getByText('No deliveries received yet')).toBeTruthy()
  })

  it('shows the recorded error and a missing webhook', async () => {
    renderCard([
      {
        ...repo,
        webhookRegistered: false,
        lastError: 'Failed to register webhook: Must have admin rights',
      },
    ])
    expect(await screen.findByText('Error')).toBeTruthy()
    expect(screen.getByText('No webhook')).toBeTruthy()
    expect(screen.getByText('Failed to register webhook: Must have admin rights')).toBeTruthy()
  })

  it('shows a switched-off repository as paused and when it last delivered', async () => {
    renderCard([{ ...repo, enabled: false, lastInboundAt: new Date().toISOString() }])
    expect(await screen.findByText('Paused')).toBeTruthy()
    expect(screen.getByText(/^Last delivery received/)).toBeTruthy()
  })

  it('renders nothing for a repository it has no row for', async () => {
    renderCard([repo], 'acme/other')
    await vi.waitFor(() => expect(mocks.destinations).toHaveBeenCalled())
    expect(screen.queryByText('Repair webhook')).toBeNull()
  })

  it('repairs the webhook and reports the outcome', async () => {
    renderCard([repo])
    fireEvent.click(await screen.findByRole('button', { name: 'Repair webhook' }))

    expect(mocks.mutate).toHaveBeenCalledTimes(1)
    const [destinationId, opts] = mocks.mutate.mock.calls[0]
    expect(destinationId).toBe('integration_destination_1')
    opts.onSuccess()
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Webhook repaired')
    opts.onError()
    expect(mocks.toastError).toHaveBeenCalledWith('Could not repair the webhook')
  })
})
