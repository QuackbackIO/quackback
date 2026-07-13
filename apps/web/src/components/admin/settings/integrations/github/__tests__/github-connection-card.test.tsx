// @vitest-environment happy-dom
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GitHubConnectionCard } from '../github-connection-card'

type Connection = Parameters<typeof GitHubConnectionCard>[0]['connection']

const mocks = vi.hoisted(() => ({
  deleteIntegration: vi.fn(),
  deleteState: {
    isPending: false,
  },
}))

vi.mock('@/lib/client/mutations', () => ({
  useDeleteIntegration: () => ({
    mutate: mocks.deleteIntegration,
    ...mocks.deleteState,
  }),
}))

vi.mock('../github-config', () => ({
  GitHubConfig: ({
    integrationId,
    enabled,
    initialConfig,
    initialEventMappings,
  }: {
    integrationId: string
    enabled: boolean
    initialConfig: Record<string, unknown>
    initialEventMappings: unknown[]
  }) => (
    <section>
      GitHub config {integrationId} {enabled ? 'enabled' : 'disabled'}{' '}
      {String(initialConfig.channelId ?? 'none')} {initialEventMappings.length} mappings
    </section>
  ),
}))

vi.mock('../github-connection-actions', () => ({
  GitHubReconnectButton: ({
    integrationId,
    label = 'Reconnect GitHub',
  }: {
    integrationId: string
    label?: string
    className?: string
  }) => (
    <button type="button">
      {label} {integrationId}
    </button>
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({
    children,
    title,
  }: {
    children: ReactNode
    variant?: string
    className?: string
    title?: string
  }) => <span title={title}>{children}</span>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    'aria-label': ariaLabel,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    variant?: string
    size?: string
    className?: string
    'aria-label'?: string
  }) => (
    <button type="button" disabled={disabled} onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/shared/confirm-dialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    description,
    confirmLabel,
    onConfirm,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description?: ReactNode
    confirmLabel?: string
    variant?: string
    onConfirm: () => void
  }) =>
    open ? (
      <section>
        <h2>{title}</h2>
        <p>{description}</p>
        <button type="button" onClick={onConfirm}>
          {confirmLabel ?? 'Confirm'}
        </button>
      </section>
    ) : null,
}))

vi.mock('@/components/ui/collapsible', async () => {
  const React = await import('react')
  const CollapsibleContext = React.createContext<{
    open: boolean
    onOpenChange?: (open: boolean) => void
  }>({ open: false })

  return {
    Collapsible: ({
      children,
      open,
      onOpenChange,
    }: {
      children: ReactNode
      open: boolean
      onOpenChange?: (open: boolean) => void
    }) => (
      <CollapsibleContext.Provider value={{ open, onOpenChange }}>
        <div>{children}</div>
      </CollapsibleContext.Provider>
    ),
    CollapsibleTrigger: ({
      children,
    }: {
      children: ReactElement<{ onClick?: (event: unknown) => void }>
      asChild?: boolean
    }) => {
      const context = React.useContext(CollapsibleContext)
      return React.cloneElement(children, {
        onClick: (event: unknown) => {
          children.props.onClick?.(event)
          context.onOpenChange?.(!context.open)
        },
      })
    },
    CollapsibleContent: ({ children }: { children: ReactNode; className?: string }) => {
      const context = React.useContext(CollapsibleContext)
      return context.open ? <div>{children}</div> : null
    },
  }
})

vi.mock('@heroicons/react/24/solid', () => ({
  ArrowPathIcon: () => <span aria-hidden="true">refresh</span>,
  ChevronDownIcon: () => <span aria-hidden="true">chevron</span>,
  FolderIcon: () => <span aria-hidden="true">folder</span>,
  TrashIcon: () => <span aria-hidden="true">trash</span>,
}))

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'integration_1',
    status: 'active',
    label: 'Fallback repo',
    config: {
      channelId: 'acme/support',
      syncDirection: 'outbound',
    },
    lastError: null,
    eventMappings: [
      {
        id: 'mapping_1',
        eventType: 'ticket.created',
        enabled: true,
        filters: null,
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.deleteState.isPending = false
})

describe('GitHubConnectionCard', () => {
  it('renders an active repository summary and expands the integration config', () => {
    render(<GitHubConnectionCard connection={connection()} />)

    expect(screen.getByText('acme/support')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('outbound sync')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reconnect integration_1/ })).toBeInTheDocument()
    expect(screen.queryByText(/GitHub config integration_1/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /acme\/support/ }))

    expect(
      screen.getByText('GitHub config integration_1 enabled acme/support 1 mappings')
    ).toBeInTheDocument()
  })

  it('shows paused and error states, then confirms repository disconnect', async () => {
    render(
      <GitHubConnectionCard
        connection={connection({
          status: 'paused',
          config: { syncDirection: 'inbound' },
          lastError: 'GitHub token expired',
        })}
      />
    )

    expect(screen.getByText('Fallback repo')).toBeInTheDocument()
    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(screen.getByTitle('GitHub token expired')).toHaveTextContent('Error')
    expect(screen.getByText('inbound sync')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Fallback repo/ }))

    expect(screen.getByText('GitHub token expired')).toBeInTheDocument()
    expect(
      screen.getByText('GitHub config integration_1 disabled none 1 mappings')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Reconnect GitHub integration_1/ })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect GitHub repository' }))
    expect(screen.getByText('Disconnect repository')).toBeInTheDocument()
    expect(
      screen.getByText(
        'This will remove the GitHub integration for Fallback repo and stop all syncing. You can reconnect at any time.'
      )
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

    await waitFor(() => {
      expect(mocks.deleteIntegration).toHaveBeenCalledWith({ id: 'integration_1' })
    })
  })
})
