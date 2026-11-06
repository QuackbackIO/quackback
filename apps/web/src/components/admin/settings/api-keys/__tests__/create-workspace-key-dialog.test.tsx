// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { API_KEY_SCOPES } from '@/lib/shared/api-key-scopes'
import type { WorkspaceKeyRoleOption } from '@/lib/server/domains/api-keys/api-key.types'

const { mockCreateApiKeyFn, mockRoles } = vi.hoisted(() => ({
  mockCreateApiKeyFn: vi.fn(),
  mockRoles: vi.fn(),
}))

vi.mock('@/lib/server/functions/api-keys', () => ({
  createApiKeyFn: mockCreateApiKeyFn,
  fetchWorkspaceKeyRolesFn: mockRoles,
  fetchApiKeys: vi.fn(),
  fetchPersonalKeyPolicyFn: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))

import { CreateWorkspaceKeyDialog } from '../create-workspace-key-dialog'

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

function renderDialog(onKeyCreated = vi.fn()) {
  mockRoles.mockResolvedValue(ROLES)
  render(
    <IntlProvider locale="en">
      <QueryClientProvider client={new QueryClient()}>
        <CreateWorkspaceKeyDialog open={true} onOpenChange={vi.fn()} onKeyCreated={onKeyCreated} />
      </QueryClientProvider>
    </IntlProvider>
  )
  return { onKeyCreated }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CreateWorkspaceKeyDialog', () => {
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

  it('sends the name, scopes and role', async () => {
    mockCreateApiKeyFn.mockResolvedValue({
      ok: true,
      apiKey: { id: 'api_key_1', name: 'CRM sync' },
      plainTextKey: 'qb_secret',
    })
    const { onKeyCreated } = renderDialog()
    fireEvent.click(await screen.findByRole('radio', { name: 'Support lead' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'CRM sync' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))

    await waitFor(() => expect(onKeyCreated).toHaveBeenCalled())
    expect(mockCreateApiKeyFn).toHaveBeenCalledWith({
      data: { name: 'CRM sync', scopes: [...API_KEY_SCOPES], roleId: 'role_lead' },
    })
  })

  it('shows a refusal from the server', async () => {
    mockCreateApiKeyFn.mockResolvedValue({
      ok: false,
      code: 'GRANT_CEILING',
      message: "You can't grant a role with permissions you don't hold",
    })
    const { onKeyCreated } = renderDialog()
    fireEvent.click(await screen.findByRole('radio', { name: 'Data sync' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))

    expect(await screen.findByText(/permissions you don't hold/)).toBeInTheDocument()
    expect(onKeyCreated).not.toHaveBeenCalled()
  })
})
