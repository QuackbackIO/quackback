// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const setInbox = vi.fn()

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
vi.mock('@/integrations/github/server/functions', () => ({
  getGitHubChannelStatusFn: vi.fn(),
  setGitHubInboxEnabledFn: (...a: unknown[]) => setInbox(...a),
  getGitHubConnectUrl: vi.fn(),
}))
vi.mock('@/integrations/github/ui/github-connection-actions', () => ({
  GitHubConnectionActions: () => <button type="button">Connect GitHub</button>,
}))

const { GitHubChannelPage } = await import('../github-channel-page')
const { githubChannelStatusQuery } =
  await import('@/integrations/github/ui/github-channel-status-query')

let client: QueryClient

function renderPage(status: Record<string, unknown>) {
  client.setQueryData(githubChannelStatusQuery().queryKey, status as never)
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <QueryClientProvider client={client}>
        <GitHubChannelPage />
      </QueryClientProvider>
    </IntlProvider>
  )
}

const CONNECTED = {
  connected: true,
  repo: 'acme/inbox',
  username: 'bot',
  inboxEnabled: true,
  hasToken: true,
  status: 'active',
  lastError: null,
  lastErrorAt: null,
  lastOutboundAt: null,
  lastInboundAt: new Date(Date.now() - 3600_000).toISOString(),
}

beforeEach(() => {
  setInbox.mockReset()
  setInbox.mockResolvedValue({ ok: true })
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
})
afterEach(cleanup)

describe('GitHubChannelPage', () => {
  it('shows the Support / Channels / GitHub breadcrumb', () => {
    renderPage(CONNECTED)
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(crumbs.textContent).toMatch(/Support\s*\/\s*Channels\s*\/\s*GitHub/)
    expect(crumbs.querySelector('a[href="/admin/settings/channels"]')).toBeTruthy()
    expect(crumbs.querySelector('a[href="/admin/settings/support"]')).toBeTruthy()
  })

  it('titles the toggle card Inbox with a one-line description', () => {
    renderPage(CONNECTED)
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Open issues and comments in the inbox' })
    ).toBeTruthy()
    expect(screen.queryByText(/Internal notes never leave/)).toBeNull()
    expect(screen.queryByText(/Workflows that reply automatically/)).toBeNull()
  })

  it('warns that replies post as public comments', () => {
    renderPage(CONNECTED)
    expect(screen.getByText(/Replies post as public comments on the issue/)).toBeInTheDocument()
  })

  it('autosaves the inbox switch', async () => {
    renderPage(CONNECTED)
    fireEvent.click(screen.getByRole('switch', { name: 'Open issues and comments in the inbox' }))
    await waitFor(() => expect(setInbox).toHaveBeenCalledWith({ data: { enabled: false } }))
    expect(client.getMutationCache().getAll()[0].meta).toEqual({
      autosave: true,
      showServerMessage: true,
    })
  })

  it('shows sync times in a Sync card instead of a Health panel', () => {
    renderPage(CONNECTED)
    expect(screen.getByRole('heading', { name: 'Sync' })).toBeInTheDocument()
    expect(screen.queryByText('Health')).toBeNull()
    expect(screen.getByText('Last sent')).toBeInTheDocument()
    expect(screen.getByText('No deliveries yet')).toBeInTheDocument()
    expect(screen.getByText('Last received')).toBeInTheDocument()
    expect(screen.getByText(/1 hour ago/)).toBeInTheDocument()
  })
})
