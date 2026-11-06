// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import userEvent from '@testing-library/user-event'
import type { ManagedApiKey } from '@/lib/server/domains/api-keys/api-key.types'

vi.mock('../create-workspace-key-dialog', () => ({
  CreateWorkspaceKeyDialog: ({ open }: { open: boolean }) =>
    open ? <p>Create workspace key form</p> : null,
}))
vi.mock('../change-key-role-dialog', () => ({
  ChangeKeyRoleDialog: ({ open, apiKey }: { open: boolean; apiKey: ManagedApiKey }) =>
    open ? <p>Changing role of {apiKey.name}</p> : null,
}))
vi.mock('../rename-api-key-dialog', () => ({
  RenameApiKeyDialog: ({ open, apiKey }: { open: boolean; apiKey: ManagedApiKey }) =>
    open ? <p>Renaming {apiKey.name}</p> : null,
}))
vi.mock('../api-key-reveal-dialog', () => ({ ApiKeyRevealDialog: () => null }))
vi.mock('../revoke-api-key-dialog', () => ({
  RevokeApiKeyDialog: ({ open, apiKey }: { open: boolean; apiKey: ManagedApiKey }) =>
    open ? <p>Revoking {apiKey.name}</p> : null,
}))
vi.mock('../rotate-api-key-dialog', () => ({
  RotateApiKeyDialog: ({ open, apiKey }: { open: boolean; apiKey: ManagedApiKey }) =>
    open ? <p>Rotating {apiKey.name}</p> : null,
}))
vi.mock('@/lib/server/functions/api-keys', () => ({
  revokeApiKeyFn: vi.fn(),
  rotateApiKeyFn: vi.fn(),
  updateApiKeyFn: vi.fn(),
}))

const { WorkspaceKeysSettings } = await import('../workspace-keys-settings')
const intl = ({ children }: { children: React.ReactNode }) => (
  <IntlProvider locale="en">{children}</IntlProvider>
)

afterEach(cleanup)

function key(over: Partial<ManagedApiKey> = {}): ManagedApiKey {
  return {
    id: 'api_key_1',
    name: 'Warehouse sync',
    kind: 'workspace',
    keyPrefix: 'qb_9a07e3c11',
    createdById: 'principal_1',
    creatorName: 'Priya Shah',
    creatorIsTeammate: true,
    role: { id: 'role_lead', name: 'Support lead' },
    createdAt: new Date('2026-10-23T12:00:00Z'),
    lastUsedAt: null,
    expiresAt: null,
    scopes: null,
    ...over,
  } as unknown as ManagedApiKey
}

describe('WorkspaceKeysSettings', () => {
  it('shows name, role, creator with date, and last used', () => {
    render(<WorkspaceKeysSettings apiKeys={[key()]} />, { wrapper: intl })
    expect(screen.getByRole('heading', { name: 'Workspace keys' })).toBeInTheDocument()
    for (const header of ['Name', 'Role', 'Created by', 'Last used'])
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument()
    const row = screen.getByRole('row', { name: /Warehouse sync/ })
    expect(within(row).getByText('Support lead')).toBeInTheDocument()
    expect(within(row).getByText('Priya Shah, 23 Oct')).toBeInTheDocument()
    expect(within(row).getByText('Never')).toBeInTheDocument()
  })

  it('marks a creator who left and a deleted creator', () => {
    render(
      <WorkspaceKeysSettings
        apiKeys={[
          key({
            id: 'api_key_2' as never,
            name: 'CRM sync',
            creatorName: 'Sam Cole',
            creatorIsTeammate: false,
          }),
          key({
            id: 'api_key_3' as never,
            name: 'Orphan',
            createdById: null,
            creatorName: null,
            creatorIsTeammate: false,
          }),
        ]}
      />,
      { wrapper: intl }
    )
    expect(screen.getByText('Sam Cole (removed), 23 Oct')).toBeInTheDocument()
    expect(screen.getByText('Removed teammate, 23 Oct')).toBeInTheDocument()
  })

  it('opens the create dialog from "New workspace key"', async () => {
    const user = userEvent.setup()
    render(<WorkspaceKeysSettings apiKeys={[]} />, { wrapper: intl })
    await user.click(screen.getAllByRole('button', { name: 'New workspace key' })[0])
    expect(await screen.findByText('Create workspace key form')).toBeInTheDocument()
  })

  it.each([
    ['Rename', 'Renaming Warehouse sync'],
    ['Change role', 'Changing role of Warehouse sync'],
    ['Rotate', 'Rotating Warehouse sync'],
    ['Revoke', 'Revoking Warehouse sync'],
  ])('opens %s from the row menu', async (item, shown) => {
    const user = userEvent.setup()
    render(<WorkspaceKeysSettings apiKeys={[key()]} />, { wrapper: intl })
    await user.click(screen.getByRole('button', { name: 'Actions for Warehouse sync' }))
    await user.click(screen.getByRole('menuitem', { name: item }))
    expect(await screen.findByText(shown)).toBeInTheDocument()
  })
})
