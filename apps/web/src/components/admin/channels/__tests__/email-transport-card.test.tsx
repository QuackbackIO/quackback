// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/lib/server/functions/settings', () => ({
  getEmailChannelStatusFn: vi.fn(),
  fetchConversationRoutingFn: vi.fn(),
  fetchEmailAutoAckFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/channel-accounts', () => ({ listRecentEmailLogFn: vi.fn() }))

const { EmailTransportCard } = await import('../email-transport-card')
const { channelSettingsQueries } = await import('@/lib/client/queries/channel-settings')

function renderCard(customDomains: 'available' | 'unavailable') {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(channelSettingsQueries.emailStatus().queryKey, {
    provider: 'ses',
    fromAddress: 'help@acme.com',
    inboundConfigured: true,
    inboundDomain: 'mail.example.com',
    customDomains,
  } as never)
  return render(
    <QueryClientProvider client={client}>
      <EmailTransportCard />
    </QueryClientProvider>
  )
}

afterEach(cleanup)

describe('EmailTransportCard', () => {
  it('describes the server, not its environment variables', () => {
    renderCard('available')
    expect(screen.getByText('How this server sends and receives email.')).toBeTruthy()
  })

  it('reports custom sending domains as available', () => {
    renderCard('available')
    expect(screen.getByText('Custom sending domains')).toBeTruthy()
    expect(screen.getByText('Available')).toBeTruthy()
  })

  it('reports custom sending domains as not available', () => {
    renderCard('unavailable')
    expect(screen.getByText('Not available')).toBeTruthy()
    expect(screen.queryByText('Available')).toBeNull()
  })
})
