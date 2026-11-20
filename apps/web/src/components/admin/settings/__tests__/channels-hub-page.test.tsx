// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
    className,
    ...rest
  }: {
    to: string
    search?: Record<string, string>
    children: React.ReactNode
    className?: string
  }) => (
    <a
      href={`${to}${search ? `?${new URLSearchParams(search)}` : ''}`}
      className={className}
      {...rest}
    >
      {children}
    </a>
  ),
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => ({
    featureFlags: { supportInbox: true },
    portalConfig: {
      support: { enabled: true },
      sectionDomains: {
        support: { hostname: 'support.acme.com', verifiedAt: '2026-11-01T00:00:00.000Z' },
      },
    },
  }),
  useBaseUrl: () => 'https://acme.com',
  // A viewer holding every permission, routing.manage included.
  useHasPermission: () => true,
}))
const canOpen = vi.hoisted(() => ({ github: true }))
vi.mock('@/lib/client/hooks/use-permission', () => ({
  useCanOpenSettingsPage: (path: string) =>
    path === '/admin/settings/channels/github' ? canOpen.github : true,
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
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
})
afterEach(() => {
  cleanup()
  canOpen.github = true
})

const WORKING_GITHUB = {
  connected: true,
  repo: 'acme/inbox',
  inboxEnabled: true,
  hasToken: true,
  status: 'active',
  lastError: null,
}

describe('ChannelsHubPage', () => {
  it("shows the portal Support section's custom domain read-only", () => {
    seed(WORKING_GITHUB)
    renderPage()
    expect(screen.getByText('Custom domain')).toBeTruthy()
    expect(screen.getByText('support.acme.com')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Custom domains' }).getAttribute('href')).toBe(
      '/admin/settings/portal?tab=custom-domains'
    )
  })

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

  it('leaves out a channel row whose page the viewer cannot open', () => {
    // The GitHub page needs channel_account.manage.
    canOpen.github = false
    seed(WORKING_GITHUB)
    renderPage()
    expect(screen.getByText('Email').closest('a')).toBeTruthy()
    expect(screen.queryByText('GitHub')).toBeNull()
  })

  it('badges a channel only when it needs attention', () => {
    seed({ ...WORKING_GITHUB, lastError: 'Bad credentials' })
    renderPage()
    expect(screen.getByText('Needs attention')).toBeTruthy()
  })

  it('has no routing switch: it lives on the Workflows page', () => {
    seed(WORKING_GITHUB)
    renderPage()
    expect(screen.queryByRole('switch', { name: 'Auto-assign new conversations' })).toBeNull()
    expect(screen.queryByText('Conversation routing')).toBeNull()
  })
})
