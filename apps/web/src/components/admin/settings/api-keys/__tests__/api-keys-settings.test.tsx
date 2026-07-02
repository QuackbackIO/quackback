// @vitest-environment happy-dom
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiKeysSettings } from '../api-keys-settings'

type ApiKeyProp = ComponentProps<typeof ApiKeysSettings>['apiKeys'][number]

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  routerInvalidate: vi.fn(),
  acknowledgeLegacyApiKeyFn: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    invalidate: mocks.routerInvalidate,
  }),
}))

vi.mock('date-fns', () => ({
  formatDistanceToNow: (date: Date) => `distance:${date.toISOString()}`,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type = 'button',
    'aria-label': ariaLabel,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
    variant?: string
    size?: string
    className?: string
    'aria-label'?: string
  }) => (
    <button type={type} disabled={disabled} onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode; align?: string }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode
    onClick?: () => void
    className?: string
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => (
    <>{children}</>
  ),
}))

vi.mock('@/components/shared/empty-state', () => ({
  EmptyState: ({
    title,
    description,
    action,
  }: {
    icon: unknown
    title: string
    description: string
    action?: ReactNode
  }) => (
    <div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  ),
}))

vi.mock('@/components/shared/warning-box', () => ({
  WarningBox: ({
    title,
    description,
  }: {
    variant?: string
    title: string
    description: string
  }) => (
    <section>
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  ),
}))

vi.mock('../create-api-key-dialog', () => ({
  CreateApiKeyDialog: ({
    open,
    onOpenChange,
    onKeyCreated,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onKeyCreated: (key: ApiKeyProp, plainTextKey: string) => void
  }) =>
    open ? (
      <section role="dialog">
        <span>Create API key dialog</span>
        <button
          type="button"
          onClick={() =>
            onKeyCreated(
              {
                id: 'api_key_created',
                name: 'Created key',
                keyPrefix: 'qb_live_created',
                createdAt: new Date('2026-06-01T00:00:00.000Z'),
                lastUsedAt: null,
                scopes: ['tickets:read'],
                compatLegacyFullAccess: false,
              } as unknown as ApiKeyProp,
              'qb_new'
            )
          }
        >
          Finish create
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close create
        </button>
      </section>
    ) : null,
}))

vi.mock('../api-key-reveal-dialog', () => ({
  ApiKeyRevealDialog: ({
    open,
    keyValue,
    keyName,
    onClose,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    keyValue: string | null
    keyName: string
    onClose: () => void
  }) =>
    open ? (
      <section role="dialog">
        <span>
          Reveal {keyName}: {keyValue}
        </span>
        <button type="button" onClick={onClose}>
          Close reveal
        </button>
      </section>
    ) : null,
}))

vi.mock('../revoke-api-key-dialog', () => ({
  RevokeApiKeyDialog: ({ open, apiKey }: { open: boolean; apiKey: ApiKeyProp }) =>
    open ? <section role="dialog">Revoke {apiKey.name}</section> : null,
}))

vi.mock('../rotate-api-key-dialog', () => ({
  RotateApiKeyDialog: ({
    open,
    apiKey,
    onKeyRotated,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    apiKey: ApiKeyProp
    onKeyRotated: (key: ApiKeyProp, plainTextKey: string) => void
  }) =>
    open ? (
      <section role="dialog">
        <span>Rotate {apiKey.name}</span>
        <button type="button" onClick={() => onKeyRotated(apiKey, 'qb_rotated')}>
          Finish rotate
        </button>
      </section>
    ) : null,
}))

vi.mock('../edit-api-key-dialog', () => ({
  EditApiKeyDialog: ({ open, apiKey }: { open: boolean; apiKey: ApiKeyProp }) =>
    open ? <section role="dialog">Edit {apiKey.name}</section> : null,
}))

vi.mock('../api-key-detail-panel', () => ({
  ApiKeyDetailPanel: ({ apiKey }: { apiKey: ApiKeyProp }) => (
    <section>Details for {apiKey.name}</section>
  ),
}))

vi.mock('@heroicons/react/24/outline', () => ({
  ArrowPathIcon: () => <span aria-hidden="true">rotate</span>,
  ChevronDownIcon: () => <span aria-hidden="true">down</span>,
  ChevronRightIcon: () => <span aria-hidden="true">right</span>,
  KeyIcon: () => <span aria-hidden="true">key</span>,
  PencilIcon: () => <span aria-hidden="true">pencil</span>,
  PlusIcon: () => <span aria-hidden="true">plus</span>,
  TrashIcon: () => <span aria-hidden="true">trash</span>,
}))

vi.mock('@heroicons/react/24/solid', () => ({
  EllipsisVerticalIcon: () => <span aria-hidden="true">ellipsis</span>,
}))

vi.mock('@/lib/server/functions/api-keys', () => ({
  acknowledgeLegacyApiKeyFn: mocks.acknowledgeLegacyApiKeyFn,
}))

function apiKey(overrides: Partial<ApiKeyProp> = {}): ApiKeyProp {
  return {
    id: 'api_key_1',
    name: 'Primary key',
    keyPrefix: 'qb_live_123',
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    lastUsedAt: null,
    scopes: ['tickets:read'],
    compatLegacyFullAccess: false,
    ...overrides,
  } as unknown as ApiKeyProp
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.acknowledgeLegacyApiKeyFn.mockResolvedValue(undefined)
})

describe('ApiKeysSettings', () => {
  it('renders empty state and opens create/reveal dialogs after key creation', () => {
    render(<ApiKeysSettings apiKeys={[]} />)

    expect(screen.getByText('No API keys yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create your first API key' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Create API key dialog')

    fireEvent.click(screen.getByRole('button', { name: 'Finish create' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Reveal Created key: qb_new')
    fireEvent.click(screen.getByRole('button', { name: 'Close reveal' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Reveal Created key:')
  })

  it('renders active keys, legacy warning, timestamps and expandable detail panels', () => {
    render(
      <ApiKeysSettings
        apiKeys={[
          apiKey({
            id: 'api_key_legacy',
            name: 'Legacy key',
            scopes: [],
            compatLegacyFullAccess: true,
            lastUsedAt: new Date('2026-06-10T00:00:00.000Z'),
          }),
          apiKey({ id: 'api_key_scoped', name: 'Scoped key', keyPrefix: 'qb_live_456' }),
        ]}
      />
    )

    expect(screen.getByText('1 key have legacy full access')).toBeInTheDocument()
    expect(screen.getByText('2 active keys')).toBeInTheDocument()
    expect(screen.getByText('Legacy key')).toBeInTheDocument()
    expect(screen.getByText('Scoped key')).toBeInTheDocument()
    expect(screen.getByText('qb_live_456...')).toBeInTheDocument()
    expect(screen.getAllByText(/distance:2026-06-01T00:00:00.000Z/)).toHaveLength(2)
    expect(screen.getByText('Never used')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Expand details' })[0])
    expect(screen.getByText('Details for Legacy key')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse details' }))
    expect(screen.queryByText('Details for Legacy key')).not.toBeInTheDocument()
  })

  it('opens edit, revoke and rotate flows and reveals rotated keys', () => {
    render(<ApiKeysSettings apiKeys={[apiKey({ name: 'Ops key' })]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit Ops key API key' }))
    expect(screen.getByText('Edit Ops key')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Revoke Ops key API key' }))
    expect(screen.getByText('Revoke Ops key')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Rotate Ops key API key' }))
    expect(screen.getByText('Rotate Ops key')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Finish rotate' }))
    expect(screen.getByText('Reveal Ops key: qb_rotated')).toBeInTheDocument()
  })

  it('acknowledges scoped legacy keys and opens edit for unscoped legacy keys', async () => {
    render(
      <ApiKeysSettings
        apiKeys={[
          apiKey({
            id: 'api_key_unscoped',
            name: 'Unscoped legacy',
            scopes: [],
            compatLegacyFullAccess: true,
          }),
          apiKey({
            id: 'api_key_scoped_legacy',
            name: 'Scoped legacy',
            scopes: ['tickets:read'],
            compatLegacyFullAccess: true,
          }),
        ]}
      />
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Acknowledge & lock down' })[0])
    expect(screen.getByText('Edit Unscoped legacy')).toBeInTheDocument()
    expect(mocks.acknowledgeLegacyApiKeyFn).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('button', { name: 'Acknowledge & lock down' })[1])
    await waitFor(() => {
      expect(mocks.acknowledgeLegacyApiKeyFn).toHaveBeenCalledWith({
        data: { id: 'api_key_scoped_legacy' },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['admin', 'api-keys'],
    })
    expect(mocks.routerInvalidate).toHaveBeenCalled()
  })

  it('keeps legacy acknowledgement failures contained', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.acknowledgeLegacyApiKeyFn.mockRejectedValueOnce(new Error('Acknowledge denied'))
    render(
      <ApiKeysSettings
        apiKeys={[
          apiKey({
            id: 'api_key_scoped_legacy',
            scopes: ['tickets:read'],
            compatLegacyFullAccess: true,
          }),
        ]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge & lock down' }))
    await waitFor(() => {
      expect(mocks.acknowledgeLegacyApiKeyFn).toHaveBeenCalledWith({
        data: { id: 'api_key_scoped_legacy' },
      })
    })
    expect(mocks.invalidateQueries).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to acknowledge legacy API key:',
      expect.any(Error)
    )
    consoleError.mockRestore()
  })
})
