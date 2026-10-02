// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const updateRouting = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    className,
    ...rest
  }: {
    to: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={to} className={className} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => ({ featureFlags: { supportInbox: true } }),
}))
vi.mock('@/lib/server/functions/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/settings')>()),
  updateConversationRoutingFn: (...args: unknown[]) => updateRouting(...args),
}))
vi.mock('@/lib/server/functions/channel-accounts', () => ({ listRecentEmailLogFn: vi.fn() }))
vi.mock('@/integrations/github/server/functions', () => ({ getGitHubChannelStatusFn: vi.fn() }))

const { ChannelsHubPage } = await import('../channels-hub-page')
const { settingsQueries } = await import('@/lib/client/queries/settings')
const { channelSettingsQueries } = await import('@/lib/client/queries/channel-settings')
const { githubChannelStatusQuery } =
  await import('@/integrations/github/ui/github-channel-status-query')

let client: QueryClient

function seed(github: Record<string, unknown>) {
  client.setQueryData(settingsQueries.widgetConfig().queryKey, {
    tabs: { messenger: true },
  } as never)
  client.setQueryData(settingsQueries.portalConfig().queryKey, {
    support: { enabled: true },
  } as never)
  client.setQueryData(channelSettingsQueries.emailStatus().queryKey, {
    inboundConfigured: true,
    inboundDomain: 'mail.example.app',
    fromAddress: 'a@b.c',
  } as never)
  client.setQueryData(githubChannelStatusQuery().queryKey, github as never)
  client.setQueryData(channelSettingsQueries.routing().queryKey, { enabled: false } as never)
}

function renderPage() {
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <QueryClientProvider client={client}>
        <ChannelsHubPage />
      </QueryClientProvider>
    </IntlProvider>
  )
}

beforeEach(() => {
  updateRouting.mockReset()
  updateRouting.mockResolvedValue({})
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
})
afterEach(cleanup)

const WORKING_GITHUB = {
  connected: true,
  repo: 'acme/inbox',
  inboxEnabled: true,
  hasToken: true,
  status: 'active',
  lastError: null,
}

describe('ChannelsHubPage', () => {
  it('has no breadcrumb of its own, as a page of the Support module', () => {
    seed(WORKING_GITHUB)
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Channels' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
  })

  it('links each channel row to its page with a chevron and no badge when it works', () => {
    seed(WORKING_GITHUB)
    renderPage()
    for (const [name, href] of [
      ['Messenger', '/admin/settings/channels/messenger'],
      ['Email', '/admin/settings/channels/email'],
      ['GitHub', '/admin/settings/channels/github'],
    ]) {
      const row = screen.getByText(name).closest('a')
      expect(row?.getAttribute('href')).toBe(href)
      expect(row?.querySelector('[data-slot="settings-list-chevron"]')).toBeTruthy()
    }
    expect(screen.queryByText('On')).toBeNull()
    expect(screen.queryByText('Receiving')).toBeNull()
    expect(screen.getByText('mail.example.app')).toBeTruthy()
    expect(screen.getByText('acme/inbox')).toBeTruthy()
  })

  it('badges a channel only when it needs attention', () => {
    seed({ ...WORKING_GITHUB, lastError: 'Bad credentials' })
    renderPage()
    expect(screen.getByText('Needs attention')).toBeTruthy()
  })

  it('saves the routing switch as an autosave mutation', async () => {
    seed(WORKING_GITHUB)
    renderPage()
    const toggle = screen.getByRole('switch', { name: 'Auto-assign new conversations' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(updateRouting).toHaveBeenCalledWith({
        data: { enabled: true, strategy: 'auto_assign_active' },
      })
    )
    const mutation = client.getMutationCache().getAll()[0]
    expect(mutation.meta).toEqual({ autosave: true })
  })
})
