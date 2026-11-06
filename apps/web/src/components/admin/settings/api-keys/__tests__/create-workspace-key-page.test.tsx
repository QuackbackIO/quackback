// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { API_KEY_SCOPES } from '@/lib/shared/api-key-scopes'
import type { WorkspaceKeyRoleOption } from '@/lib/server/domains/api-keys/api-key.types'

const { mockCreateApiKeyFn, mockRoles, navigate } = vi.hoisted(() => ({
  mockCreateApiKeyFn: vi.fn(),
  mockRoles: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('@/lib/server/functions/api-keys', () => ({
  createApiKeyFn: mockCreateApiKeyFn,
}))
vi.mock('@/lib/server/functions/workspace-api-key-settings', () => ({
  fetchWorkspaceKeyRolesFn: mockRoles,
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  useNavigate: () => navigate,
}))
vi.mock('@/components/admin/settings/settings-page', () => ({
  SettingsPage: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}))
vi.mock('../api-key-reveal-dialog', () => ({
  ApiKeyRevealDialog: ({
    open,
    keyName,
    onClose,
  }: {
    open: boolean
    keyName: string
    onClose: () => void
  }) =>
    open ? (
      <div>
        <p>Revealing {keyName}</p>
        <button onClick={onClose}>Done</button>
      </div>
    ) : null,
}))

import { CreateWorkspaceKeyPage } from '../create-workspace-key-page'

const ROLES: WorkspaceKeyRoleOption[] = [
  {
    id: 'role_owner',
    key: 'owner',
    name: 'Owner',
    isSystem: true,
    grantable: false,
    highImpact: true,
  },
  {
    id: 'role_admin',
    key: 'admin',
    name: 'Admin',
    isSystem: true,
    grantable: true,
    highImpact: true,
  },
  {
    id: 'role_lead',
    key: 'support_lead',
    name: 'Support lead',
    isSystem: true,
    grantable: true,
    highImpact: false,
  },
  {
    id: 'role_sync',
    key: 'role_sync',
    name: 'Data sync',
    isSystem: false,
    grantable: true,
    highImpact: false,
  },
] as unknown as WorkspaceKeyRoleOption[]

function renderDialog() {
  mockRoles.mockResolvedValue(ROLES)
  render(
    <IntlProvider locale="en">
      <QueryClientProvider client={new QueryClient()}>
        <CreateWorkspaceKeyPage />
      </QueryClientProvider>
    </IntlProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CreateWorkspaceKeyPage', () => {
  it('is a page titled "New workspace key" that says what the key can do', async () => {
    renderDialog()
    expect(screen.getByRole('heading', { name: 'New workspace key' })).toBeInTheDocument()
    expect(
      screen.getByText('The key can only do what its role allows and you select here.')
    ).toBeInTheDocument()
    await screen.findByRole('radio', { name: 'Owner' })
  })

  it('lists roles, greys out the ones the caller cannot grant, and flags high impact', async () => {
    renderDialog()
    const owner = await screen.findByRole('radio', { name: 'Owner' })
    expect(owner).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('radio', { name: 'Support lead' })).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.getAllByText('High impact').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Custom role')).toBeInTheDocument()
    expect(
      screen.getByText('You can only pick roles whose permissions you hold.')
    ).toBeInTheDocument()
  })

  it('flags read and write on Settings as high impact, and not read only', async () => {
    renderDialog()
    await screen.findByRole('radio', { name: 'Support lead' })
    const before = screen.getAllByText('High impact').length
    fireEvent.click(screen.getByRole('button', { name: 'Settings: Read' }))
    expect(screen.getAllByText('High impact').length).toBe(before - 1)
  })

  it('needs a role before it creates', async () => {
    renderDialog()
    await screen.findByRole('radio', { name: 'Support lead' })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'CRM sync' } })
    expect(screen.getByRole('button', { name: 'Create key' })).toBeDisabled()
  })

  it('shows the new key once, then returns to the keys tab', async () => {
    mockCreateApiKeyFn.mockResolvedValue({
      ok: true,
      apiKey: { id: 'api_key_1', name: 'CRM sync' },
      plainTextKey: 'qb_secret',
    })
    renderDialog()
    fireEvent.click(await screen.findByRole('radio', { name: 'Support lead' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'CRM sync' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Done' }))
    expect(navigate).toHaveBeenCalledWith({
      to: '/admin/settings/developers',
      search: { tab: 'keys' },
    })
  })

  it('sends the name, scopes and role', async () => {
    mockCreateApiKeyFn.mockResolvedValue({
      ok: true,
      apiKey: { id: 'api_key_1', name: 'CRM sync' },
      plainTextKey: 'qb_secret',
    })
    renderDialog()
    fireEvent.click(await screen.findByRole('radio', { name: 'Support lead' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'CRM sync' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))

    expect(await screen.findByText('Revealing CRM sync')).toBeInTheDocument()
    expect(mockCreateApiKeyFn).toHaveBeenCalledWith({
      data: { name: 'CRM sync', scopes: [...API_KEY_SCOPES], roleId: 'role_lead' },
    })
  })

  it('shows a refusal from the server in catalogue words', async () => {
    mockCreateApiKeyFn.mockResolvedValue({
      ok: false,
      code: 'GRANT_CEILING',
      message: "You can't grant a role with permissions you don't hold: member.manage",
    })
    renderDialog()
    fireEvent.click(await screen.findByRole('radio', { name: 'Data sync' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can only manage keys whose role you could give.'
    )
    expect(screen.queryByText(/Revealing/)).toBeNull()
  })
})
