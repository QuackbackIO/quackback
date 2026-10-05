// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const updateAck = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))
vi.mock('@/lib/server/functions/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/settings')>()),
  updateEmailAutoAckFn: (...a: unknown[]) => updateAck(...a),
}))
vi.mock('@/lib/server/functions/channel-accounts', () => ({
  listRecentEmailLogFn: vi.fn(),
  getEmailChannelConfigFn: vi.fn(),
}))

const { EmailChannelPage } = await import('../email-channel-page')
const { settingsQueries } = await import('@/lib/client/queries/settings')
const { channelSettingsQueries } = await import('@/lib/client/queries/channel-settings')
const { emailChannelConfigQuery } = await import('@/lib/client/queries/channel-accounts')

let client: QueryClient

function activity(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `log_${i}`,
    direction: 'outbound',
    emailType: `Type${i}`,
    status: 'sent',
    createdAt: new Date(Date.UTC(2026, 8, 30, 12, 0, 60 - i)).toISOString(),
  }))
}

function renderPage(rows = 12, provider = 'smtp') {
  client.setQueryData(settingsQueries.spamFilterConfig().queryKey, { trustedSenders: [] } as never)
  client.setQueryData(channelSettingsQueries.emailStatus().queryKey, {
    provider,
    fromAddress: 'Acme <noreply@acme.io>',
    inboundConfigured: true,
    inboundDomain: 'mail.acme.io',
  } as never)
  client.setQueryData(emailChannelConfigQuery().queryKey, {
    inboundRoute: null,
    platformAddress: null,
    sendingAddresses: [],
    domains: [],
  } as never)
  client.setQueryData(channelSettingsQueries.emailAutoAck().queryKey, { enabled: false } as never)
  client.setQueryData(channelSettingsQueries.emailActivity().queryKey, activity(rows) as never)
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <QueryClientProvider client={client}>
        <EmailChannelPage />
      </QueryClientProvider>
    </IntlProvider>
  )
}

beforeEach(() => {
  updateAck.mockReset()
  updateAck.mockResolvedValue({})
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
})
afterEach(cleanup)

describe('EmailChannelPage', () => {
  it('shows the Support / Channels / Email breadcrumb', () => {
    renderPage()
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(crumbs.textContent).toMatch(/Support\s*\/\s*Channels\s*\/\s*Email/)
    expect(crumbs.querySelector('a[href="/admin/settings/support"]')).toBeTruthy()
    expect(crumbs.querySelector('a[href="/admin/settings/channels"]')).toBeTruthy()
  })

  it('shows the last 5 activity rows, then every loaded row in place on View all activity', () => {
    renderPage(12)
    expect(screen.getAllByText(/^Type\d+$/, { exact: false })).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: 'View all activity' }))
    expect(screen.getAllByText(/^Type\d+$/, { exact: false })).toHaveLength(12)
  })

  it('offers no View all link when five rows or fewer exist', () => {
    renderPage(3)
    expect(screen.queryByRole('button', { name: 'View all activity' })).toBeNull()
  })

  it('drops the Always on reopen card', () => {
    renderPage()
    expect(screen.queryByText('Always on')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Reopen on reply' })).toBeNull()
  })

  it('renders the transport rows without status dots', () => {
    const { container } = renderPage()
    expect(screen.getByText('SMTP')).toBeTruthy()
    expect(screen.getByText('mail.acme.io')).toBeTruthy()
    expect(container.querySelector('.bg-emerald-500')).toBeNull()
    expect(container.querySelector('span.size-2.rounded-full')).toBeNull()
  })

  it('names each outbound provider', () => {
    for (const [provider, label] of [
      ['ses', 'Amazon SES'],
      ['resend', 'Resend'],
      ['console', 'Not configured'],
    ]) {
      renderPage(3, provider)
      expect(screen.getByText(label), provider).toBeTruthy()
      cleanup()
    }
  })

  it('drops the default note from Auto-acknowledgement', () => {
    renderPage()
    expect(screen.queryByText(/Off by default/)).toBeNull()
  })

  it('autosaves the acknowledgement switch', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('switch', { name: 'Acknowledge new inbound mail' }))
    await waitFor(() => expect(updateAck).toHaveBeenCalledWith({ data: { enabled: true } }))
    expect(client.getMutationCache().getAll()[0].meta).toEqual({ autosave: true })
  })
})
