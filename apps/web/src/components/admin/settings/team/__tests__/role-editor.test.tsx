// @vitest-environment happy-dom
/**
 * <RoleEditor> — the custom-role permission matrix.
 *
 * Covers:
 *   - category groups render with tri-state counts
 *   - toggling a key updates the granted count and the save payload
 *   - category select-all only adds keys within the editor's own ceiling
 *   - above-ceiling keys render disabled ("You don't hold this")
 *   - NEW badge appears for keys added since the role's last edit
 *   - search filters the key list
 *   - system presets render the read-only notice instead of the editor
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ALL_PERMISSIONS, PERMISSIONS } from '@/lib/shared/permissions'
import { RoleEditor } from '../role-editor'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

const updateRoleFn = vi.fn().mockResolvedValue({})
vi.mock('@/lib/server/functions/roles', () => ({
  listRolesFn: vi.fn(),
  updateRoleFn: (args: unknown) => updateRoleFn(args),
}))

// The editor's ceiling: everything except billing.manage (an Admin-grade editor).
const HELD = ALL_PERMISSIONS.filter((k) => k !== PERMISSIONS.BILLING_MANAGE)
vi.mock('@/lib/client/use-permissions', () => ({
  usePermissions: () => new Set(HELD),
  useHasPermission: (k: string) => HELD.includes(k as (typeof HELD)[number]),
}))

const CUSTOM_ROLE = {
  id: 'role_custom1',
  key: 'role_custom1',
  name: 'Support Lead',
  description: 'Support ops',
  isSystem: false,
  permissionKeys: [PERMISSIONS.POST_VIEW_PRIVATE],
  memberCount: 0,
  newPermissionKeys: [PERMISSIONS.TICKET_VIEW],
  updatedAt: new Date().toISOString(),
}

const OWNER_PRESET = {
  ...CUSTOM_ROLE,
  id: 'role_owner',
  key: 'owner',
  name: 'Owner',
  isSystem: true,
  newPermissionKeys: [],
}

function renderEditor(roleId = CUSTOM_ROLE.id) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['settings', 'roles'], [OWNER_PRESET, CUSTOM_ROLE])
  return render(
    <QueryClientProvider client={client}>
      <RoleEditor roleId={roleId} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RoleEditor', () => {
  it('renders category groups and the granted count', () => {
    renderEditor()
    expect(screen.getAllByText(/of \d+ granted/)[0]).toBeTruthy()
    expect(screen.getByText('Feedback')).toBeTruthy()
    expect(screen.getByText('Workspace')).toBeTruthy()
    expect(screen.getByDisplayValue('Support Lead')).toBeTruthy()
  })

  it('toggles a key into the save payload', async () => {
    renderEditor()
    const row = screen.getByLabelText(PERMISSIONS.TICKET_VIEW)
    fireEvent.click(row)
    fireEvent.click(screen.getByText('Save role'))
    await waitFor(() => expect(updateRoleFn).toHaveBeenCalled())
    const payload = updateRoleFn.mock.calls[0][0] as {
      data: { permissionKeys: string[] }
    }
    expect(payload.data.permissionKeys).toContain(PERMISSIONS.TICKET_VIEW)
    expect(payload.data.permissionKeys).toContain(PERMISSIONS.POST_VIEW_PRIVATE)
  })

  it('renders above-ceiling keys disabled', () => {
    renderEditor()
    const billing = screen.getByLabelText(PERMISSIONS.BILLING_MANAGE)
    expect((billing as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("You don't hold this")).toBeTruthy()
  })

  it('category select-all never adds above-ceiling keys', async () => {
    renderEditor()
    fireEvent.click(screen.getByLabelText('Toggle all Workspace permissions'))
    fireEvent.click(screen.getByText('Save role'))
    await waitFor(() => expect(updateRoleFn).toHaveBeenCalled())
    const payload = updateRoleFn.mock.calls[0][0] as {
      data: { permissionKeys: string[] }
    }
    expect(payload.data.permissionKeys).toContain(PERMISSIONS.SETTINGS_MANAGE)
    expect(payload.data.permissionKeys).not.toContain(PERMISSIONS.BILLING_MANAGE)
  })

  it('badges keys added since the last edit', () => {
    renderEditor()
    expect(screen.getByText('New')).toBeTruthy()
    expect(screen.getByText(/added since last edit/)).toBeTruthy()
  })

  it('search filters the visible keys', () => {
    renderEditor()
    fireEvent.change(screen.getByPlaceholderText(/Filter \d+ permissions/), {
      target: { value: 'billing' },
    })
    expect(screen.queryByLabelText(PERMISSIONS.TICKET_VIEW)).toBeNull()
    expect(screen.getByLabelText(PERMISSIONS.BILLING_MANAGE)).toBeTruthy()
  })

  it('shows the read-only notice for system presets', () => {
    renderEditor(OWNER_PRESET.id)
    expect(screen.getByText(/Built-in roles are read-only/)).toBeTruthy()
  })
})
