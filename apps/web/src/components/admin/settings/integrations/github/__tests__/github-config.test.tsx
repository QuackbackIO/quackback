// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GitHubConfig } from '../github-config'

type ComponentProps = {
  children?: ReactNode
  className?: string
  onClick?: () => void
  disabled?: boolean
}

const mocks = vi.hoisted(() => ({
  updateIntegration: vi.fn(),
  fetchGitHubReposFn: vi.fn(async () => [
    { id: 'repo-1', fullName: 'acme/support', private: false },
    { id: 'repo-2', fullName: 'acme/dashboard', private: true },
  ]),
  mutationState: {
    isPending: false,
    isError: false,
    error: null as Error | null,
  },
  inboxesState: {
    data: [
      { id: 'inbox-1', name: 'Support' },
      { id: 'inbox-2', name: 'Billing' },
    ],
    isLoading: false,
  },
}))

vi.mock('@/lib/client/mutations', () => ({
  useUpdateIntegration: () => ({
    mutate: mocks.updateIntegration,
    ...mocks.mutationState,
  }),
}))

vi.mock('@/lib/server/integrations/github/functions', () => ({
  fetchGitHubReposFn: mocks.fetchGitHubReposFn,
}))

vi.mock('@/lib/client/hooks/use-inboxes-queries', () => ({
  useInboxes: () => mocks.inboxesState,
}))

vi.mock('@/components/admin/settings/integrations/status-sync-config', () => ({
  StatusSyncConfig: ({
    integrationType,
    enabled,
  }: {
    integrationType: string
    enabled: boolean
  }) => (
    <div>
      Status sync {integrationType} {enabled ? 'enabled' : 'disabled'}
    </div>
  ),
}))

vi.mock('@/components/admin/settings/integrations/on-delete-config', () => ({
  OnDeleteConfig: ({ integrationType, enabled }: { integrationType: string; enabled: boolean }) => (
    <div>
      Delete config {integrationType} {enabled ? 'enabled' : 'disabled'}
    </div>
  ),
}))

vi.mock('../github-user-mappings', () => ({
  GitHubUserMappings: ({
    integrationId,
    disabled,
  }: {
    integrationId: string
    disabled: boolean
  }) => (
    <div>
      User mappings {integrationId} {disabled ? 'disabled' : 'enabled'}
    </div>
  ),
}))

vi.mock('../github-sync-history', () => ({
  GitHubSyncHistory: ({ integrationId }: { integrationId: string }) => (
    <div>Sync history {integrationId}</div>
  ),
}))

vi.mock('../github-connection-actions', () => ({
  GitHubReconnectButton: ({ label }: { label: string }) => <button type="button">{label}</button>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: ComponentProps) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor, className }: ComponentProps & { htmlFor?: string }) => (
    <label htmlFor={htmlFor} className={className}>
      {children}
    </label>
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
    id,
  }: {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    disabled?: boolean
    id?: string
  }) => (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
    />
  ),
}))

vi.mock('@/components/ui/select', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{
    onValueChange?: (value: string) => void
    disabled?: boolean
  }>({})

  return {
    Select: ({
      value,
      onValueChange,
      disabled,
      children,
    }: {
      value?: string
      onValueChange?: (value: string) => void
      disabled?: boolean
      children?: ReactNode
    }) => (
      <SelectContext.Provider value={{ onValueChange, disabled }}>
        <div data-value={value}>{children}</div>
      </SelectContext.Provider>
    ),
    SelectContent: ({ children }: ComponentProps) => <div>{children}</div>,
    SelectTrigger: ({ children }: ComponentProps) => <div>{children}</div>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
    SelectItem: ({ value, children }: ComponentProps & { value: string }) => {
      const context = React.useContext(SelectContext)
      return (
        <button
          type="button"
          disabled={context.disabled}
          onClick={() => context.onValueChange?.(value)}
        >
          {children}
        </button>
      )
    },
  }
})

function renderConfig(
  overrides: {
    config?: Record<string, unknown>
    mappings?: Array<{
      id: string
      eventType: string
      enabled: boolean
      filters?: Record<string, unknown> | null
    }>
    enabled?: boolean
  } = {}
) {
  return render(
    <GitHubConfig
      integrationId="github-1"
      enabled={overrides.enabled ?? true}
      initialConfig={{
        channelId: 'acme/support',
        syncDirection: 'outbound',
        assigneeSync: false,
        createTicketsFromIssues: false,
        defaultInboxId: '',
        ...overrides.config,
      }}
      initialEventMappings={
        overrides.mappings ?? [
          {
            id: 'map-1',
            eventType: 'ticket.created',
            enabled: true,
            filters: { inboxIds: ['inbox-1'] },
          },
          {
            id: 'map-2',
            eventType: 'post.created',
            enabled: true,
            filters: {
              repo: 'acme/support',
              labels: ['bug'],
              archived: false,
              count: 1,
              invalid: { nested: true },
            },
          },
        ]
      }
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchGitHubReposFn.mockResolvedValue([
    { id: 'repo-1', fullName: 'acme/support', private: false },
    { id: 'repo-2', fullName: 'acme/dashboard', private: true },
  ])
  mocks.mutationState = { isPending: false, isError: false, error: null }
  mocks.inboxesState = {
    data: [
      { id: 'inbox-1', name: 'Support' },
      { id: 'inbox-2', name: 'Billing' },
    ],
    isLoading: false,
  }
})

describe('GitHubConfig', () => {
  it('loads repositories and renders integration sections', async () => {
    renderConfig()

    await waitFor(() =>
      expect(mocks.fetchGitHubReposFn).toHaveBeenCalledWith({
        data: { integrationId: 'github-1' },
      })
    )

    expect(screen.getByRole('button', { name: /acme\/support/ })).toBeTruthy()
    expect(screen.getByText('Ticket events')).toBeTruthy()
    expect(screen.getByText('Feedback events')).toBeTruthy()
    expect(screen.getByText('Status sync github enabled')).toBeTruthy()
    expect(screen.getByText('Delete config github enabled')).toBeTruthy()
    expect(screen.getByText('Sync history github-1')).toBeTruthy()
  })

  it('persists core setting changes and sync direction event mappings', async () => {
    renderConfig({ config: { syncDirection: 'bidirectional', createTicketsFromIssues: true } })

    await screen.findByRole('button', { name: /acme\/dashboard/ })

    fireEvent.click(screen.getByRole('button', { name: /acme\/dashboard/ }))
    expect(mocks.updateIntegration).toHaveBeenCalledWith({
      id: 'github-1',
      config: { channelId: 'acme/dashboard' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Inbound/ }))
    expect(mocks.updateIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'github-1',
        config: { syncDirection: 'inbound' },
        eventMappings: expect.arrayContaining([
          expect.objectContaining({
            eventType: 'ticket.created',
            enabled: true,
            filters: null,
          }),
        ]),
      })
    )

    fireEvent.click(screen.getAllByRole('switch')[1])
    expect(mocks.updateIntegration).toHaveBeenCalledWith({
      id: 'github-1',
      config: { assigneeSync: true },
    })
    expect(screen.getByText('User mappings github-1 enabled')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('switch')[2])
    expect(mocks.updateIntegration).toHaveBeenCalledWith({
      id: 'github-1',
      config: { createTicketsFromIssues: false },
    })

    fireEvent.click(screen.getAllByRole('switch')[0])
    expect(mocks.updateIntegration).toHaveBeenCalledWith({ id: 'github-1', enabled: false })
  })

  it('applies inbox filters to ticket event mappings and normalizes feedback filters', async () => {
    renderConfig()

    await screen.findByRole('button', { name: /acme\/support/ })

    fireEvent.click(screen.getByRole('button', { name: 'Support' }))
    expect(mocks.updateIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'github-1',
        config: { defaultInboxId: 'inbox-1' },
        eventMappings: expect.arrayContaining([
          expect.objectContaining({
            eventType: 'ticket.created',
            filters: { inboxIds: ['inbox-1'] },
          }),
          expect.objectContaining({
            eventType: 'post.created',
            filters: {
              repo: 'acme/support',
              labels: ['bug'],
              archived: false,
              count: 1,
            },
          }),
        ]),
      })
    )

    fireEvent.click(screen.getAllByRole('switch')[2])
    expect(mocks.updateIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'github-1',
        eventMappings: expect.arrayContaining([
          expect.objectContaining({
            eventType: 'ticket.created',
            enabled: false,
          }),
        ]),
      })
    )
  })

  it('shows reconnect guidance when the configured repository is no longer visible', async () => {
    renderConfig({ config: { channelId: 'missing/repo' } })

    expect(
      await screen.findByText(
        'The configured repository is no longer visible to this GitHub authorization. Reconnect GitHub or choose another repository.'
      )
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reconnect GitHub' })).toBeTruthy()
  })

  it('shows repository fetch errors and supports manual refresh', async () => {
    mocks.fetchGitHubReposFn.mockRejectedValueOnce(new Error('GitHub unavailable'))
    renderConfig()

    expect(await screen.findByText('GitHub unavailable')).toBeTruthy()

    mocks.fetchGitHubReposFn.mockResolvedValueOnce([
      { id: 'repo-1', fullName: 'acme/support', private: false },
      { id: 'repo-3', fullName: 'acme/restored', private: false },
    ])
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }))

    expect(await screen.findByRole('button', { name: /acme\/restored/ })).toBeTruthy()
  })

  it('renders saving and mutation error states from the update mutation', () => {
    mocks.mutationState = {
      isPending: true,
      isError: true,
      error: new Error('Save failed'),
    }

    renderConfig({ enabled: false })

    expect(screen.getByText('Saving...')).toBeTruthy()
    expect(screen.getByText('Save failed')).toBeTruthy()
    expect(screen.getByText('Status sync github disabled')).toBeTruthy()
  })
})
