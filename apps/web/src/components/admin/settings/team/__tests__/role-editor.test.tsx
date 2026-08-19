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
  // BackLink renders a router Link; stub it as a plain anchor.
  Link: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
  useSearch: () => ({}),
}))

const createRoleFn = vi.fn().mockResolvedValue({ role: {}, droppedKeys: [] })
const updateRoleFn = vi.fn().mockResolvedValue({})
vi.mock('@/lib/server/functions/roles', () => ({
  listRolesFn: vi.fn(),
  createRoleFn: (args: unknown) => createRoleFn(args),
  updateRoleFn: (args: unknown) => updateRoleFn(args),
  deleteRoleFn: vi.fn().mockResolvedValue({ reassignedCount: 0 }),
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
  client.setQueryData(['settings', 'roles'], {
    roles: [OWNER_PRESET, CUSTOM_ROLE],
    maxCustomRoles: null,
  })
  return render(
    <QueryClientProvider client={client}>
      <RoleEditor mode="edit" roleId={roleId} />
    </QueryClientProvider>
  )
}

function renderCreate(duplicateFromId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['settings', 'roles'], {
    roles: [OWNER_PRESET, CUSTOM_ROLE],
    maxCustomRoles: null,
  })
  return render(
    <QueryClientProvider client={client}>
      <RoleEditor mode="create" duplicateFromId={duplicateFromId} />
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
    fireEvent.click(screen.getByRole('button', { name: /Workspace/ }))
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
    // One badge on the category header, one on the key row.
    expect(screen.getAllByText('New').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/added since last edit/)).toBeTruthy()
  })

  it('search filters the visible keys and expands matches', () => {
    renderEditor()
    // Collapsed by default: billing.manage (workspace) isn't rendered yet.
    expect(screen.queryByLabelText(PERMISSIONS.BILLING_MANAGE)).toBeNull()
    fireEvent.change(screen.getByPlaceholderText(/Filter \d+ permissions/), {
      target: { value: 'billing' },
    })
    expect(screen.queryByLabelText(PERMISSIONS.TICKET_VIEW)).toBeNull()
    expect(screen.getByLabelText(PERMISSIONS.BILLING_MANAGE)).toBeTruthy()
  })

  it('opens categories carrying newly-shipped keys by default', () => {
    renderEditor()
    // ticket.export-style New key: its category (support) starts expanded.
    expect(screen.getByLabelText(PERMISSIONS.TICKET_VIEW)).toBeTruthy()
  })

  it('renders system presets read-only (no Save, offers Duplicate)', () => {
    renderEditor(OWNER_PRESET.id)
    // The name is static text, not an editable input.
    expect(screen.getByRole('heading', { name: 'Owner' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save role' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeTruthy()
  })

  it('create mode shows the Start-from band and a Create button', () => {
    renderCreate()
    expect(screen.getByText('Start from')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create role' })).toBeTruthy()
    // Blank start: nothing selected (chip + footer both show it).
    expect(screen.getAllByText(/0 of \d+ selected/).length).toBeGreaterThanOrEqual(1)
  })

  it('create with a duplicate source stages the source permissions (ceiling-filtered)', () => {
    // Duplicating the custom role (holds POST_VIEW_PRIVATE, within the ceiling).
    renderCreate(CUSTOM_ROLE.id)
    expect(screen.getByDisplayValue('Support Lead copy')).toBeTruthy()
    expect(screen.getAllByText(/1 of \d+ selected/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/staged from/)).toBeTruthy()
  })
})
