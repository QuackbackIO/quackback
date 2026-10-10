// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ReactNode } from 'react'
import type { IntegrationSettingsEntry } from '../integration-settings-registry'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))
const toastSuccess = vi.fn()
vi.mock('sonner', () => ({ toast: { success: (m: string) => toastSuccess(m), error: vi.fn() } }))
vi.mock('../platform-credentials-dialog', () => ({ PlatformCredentialsDialog: () => null }))
vi.mock('../integration-sync-history', () => ({ IntegrationSyncHistory: () => null }))

const { IntegrationDetail } = await import('../integration-detail')

afterEach(() => {
  cleanup()
  toastSuccess.mockClear()
})

function makeEntry(over: Partial<IntegrationSettingsEntry> = {}): IntegrationSettingsEntry {
  return {
    type: 'slack',
    catalog: {
      id: 'slack',
      name: 'Slack',
      description: 'Send feedback from Slack and get notified about changes.',
      category: 'notifications',
      iconBg: 'bg-purple-600',
      settingsPath: '/admin/settings/integrations/slack',
      available: true,
      configurable: false,
      docsUrl: 'https://docs.example.test/slack',
    },
    Icon: () => <svg data-testid="brand-icon" />,
    ConnectionActions: ({ isConnected }) => (
      <button type="button">{isConnected ? 'Disconnect' : 'Connect Slack'}</button>
    ),
    setup: {
      title: 'Connect your Slack workspace',
      description: 'Notifications when users submit feedback.',
      steps: [<p key="1">Authorize Quackback</p>],
    },
    renderConfig: () => <p>channel config</p>,
    ...over,
  } as IntegrationSettingsEntry
}

const baseData = {
  integration: null,
  platformCredentialFields: [],
  platformCredentialsConfigured: false,
  platformCredentialsManaged: false,
  syncHistoryAvailable: false,
}

const connected = {
  id: 'int_1',
  status: 'active' as const,
  workspaceName: 'Acme',
  config: {},
  eventMappings: [],
  health: {
    lastOutboundAt: null,
    lastInboundAt: null,
    lastError: null,
    lastErrorAt: null,
    attentionCount: 0,
  },
}

function renderDetail(props: Partial<Parameters<typeof IntegrationDetail>[0]> = {}) {
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <QueryClientProvider client={new QueryClient()}>
        <IntegrationDetail
          type="slack"
          entry={makeEntry()}
          data={baseData}
          historyRequested={false}
          onHistoryHandled={() => {}}
          {...props}
        />
      </QueryClientProvider>
    </IntlProvider>
  )
}

function header(container: HTMLElement) {
  return container.querySelector('[data-page-header]') as HTMLElement
}

describe('IntegrationDetail before connecting', () => {
  it('shows an Integrations / Slack breadcrumb and the primary connect action in the header', () => {
    const { container } = renderDetail()
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByRole('link', { name: 'Integrations' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Slack' })).toBeInTheDocument()
    expect(within(header(container)).getByRole('button', { name: 'Connect Slack' })).toBeTruthy()
    expect(
      within(header(container)).getByRole('link', { name: /Learn how to set up Slack/ })
    ).toBeTruthy()
  })

  it('has no Health panel and no empty delivery copy', () => {
    renderDetail()
    expect(screen.queryByText('Health')).toBeNull()
    expect(screen.queryByText(/No deliveries yet/)).toBeNull()
    expect(screen.queryByText(/None received/)).toBeNull()
  })

  it('keeps the setup steps and uses the one-clause catalog description', () => {
    renderDetail()
    expect(screen.getByText('Authorize Quackback')).toBeInTheDocument()
    expect(
      screen.getByText('Send feedback from Slack and get notified about changes.')
    ).toBeInTheDocument()
  })

  it('puts a form-style connect inside the setup card, not the header', () => {
    const { container } = renderDetail({ entry: makeEntry({ connectForm: true }) })
    expect(within(header(container)).queryByRole('button', { name: 'Connect Slack' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Connect Slack' })).toBeInTheDocument()
  })

  it('offers credentials as the primary header action when that is the only way in', () => {
    const { container } = renderDetail({
      data: {
        ...baseData,
        platformCredentialFields: [{ key: 'clientId', label: 'Client ID' }] as never,
      },
      entry: makeEntry({
        ConnectionActions: () => null,
      }),
    })
    expect(
      within(header(container)).getByRole('button', { name: 'Configure credentials' })
    ).toBeInTheDocument()
  })
})

describe('IntegrationDetail once connected', () => {
  it('shows Health, the config panel and Disconnect in the header', () => {
    const { container } = renderDetail({ data: { ...baseData, integration: connected } })
    expect(screen.getByText('Health')).toBeInTheDocument()
    expect(screen.getByText('channel config')).toBeInTheDocument()
    expect(within(header(container)).getByRole('button', { name: 'Disconnect' })).toBeTruthy()
    expect(screen.queryByText('Authorize Quackback')).toBeNull()
  })

  it('names the workspace in the description', () => {
    renderDetail({ data: { ...baseData, integration: connected } })
    expect(screen.getByText('Connected to Acme')).toBeInTheDocument()
  })
})

describe('IntegrationDetail states', () => {
  it('hides Health while the integration is pending', () => {
    renderDetail({ data: { ...baseData, integration: { ...connected, status: 'pending' } } })
    expect(screen.queryByText('Health')).toBeNull()
  })

  it('shows a paused integration as "Off", the same as the index', () => {
    renderDetail({ data: { ...baseData, integration: { ...connected, status: 'paused' } } })
    expect(screen.getByText('Off')).toBeInTheDocument()
    expect(screen.queryByText(/Paused/)).toBeNull()
    expect(screen.getByText('Health')).toBeInTheDocument()
  })

  it('confirms a connect that finishes on this page, even though the setup card unmounts', () => {
    const view = renderDetail({ entry: makeEntry({ connectForm: true }) })
    expect(toastSuccess).not.toHaveBeenCalled()
    view.rerender(
      <IntlProvider locale="en" defaultLocale="en">
        <QueryClientProvider client={new QueryClient()}>
          <IntegrationDetail
            type="slack"
            entry={makeEntry({ connectForm: true })}
            data={{ ...baseData, integration: connected }}
            historyRequested={false}
            onHistoryHandled={() => {}}
          />
        </QueryClientProvider>
      </IntlProvider>
    )
    expect(toastSuccess).toHaveBeenCalledWith('Connected successfully')
  })

  it('does not announce a connect when the page simply loads connected', () => {
    renderDetail({ data: { ...baseData, integration: connected } })
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})
