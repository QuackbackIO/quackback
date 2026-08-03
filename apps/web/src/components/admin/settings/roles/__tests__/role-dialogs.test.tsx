// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RoleId } from '@quackback/ids'
import { DeleteRoleDialog } from '../delete-role-dialog'
import { RoleCreateDialog } from '../role-create-dialog'
import { RoleDetailPanel } from '../role-detail-panel'
import { RoleEditDialog } from '../role-edit-dialog'
import { RoleList } from '../role-list'
import { RolePermissionMatrix } from '../role-permission-matrix'
import { RolesSettings } from '../roles-settings'

const mocks = vi.hoisted(() => ({
  createRoleFn: vi.fn(),
  deleteRoleFn: vi.fn(),
  getRoleFn: vi.fn(),
  setRolePermissionsFn: vi.fn(),
  updateRoleFn: vi.fn(),
  invalidateQueries: vi.fn(),
  routerInvalidate: vi.fn(),
  roleDetail: {
    permissionKeys: ['tickets.read'],
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useSuspenseQuery: () => ({
    data: mocks.roleDetail,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    invalidate: mocks.routerInvalidate,
  }),
}))

vi.mock('@/lib/server/functions/roles', () => ({
  createRoleFn: mocks.createRoleFn,
  deleteRoleFn: mocks.deleteRoleFn,
  getRoleFn: mocks.getRoleFn,
  setRolePermissionsFn: mocks.setRolePermissionsFn,
  updateRoleFn: mocks.updateRoleFn,
}))

vi.mock('@/components/admin/settings/api-keys/scope-picker', () => ({
  ScopePicker: ({
    value,
    onChange,
    disabled,
  }: {
    value: string[]
    onChange: (value: string[]) => void
    disabled?: boolean
  }) => (
    <div>
      <span>Scopes: {value.join(', ') || 'none'}</span>
      <span>Picker {disabled ? 'disabled' : 'enabled'}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          onChange([...value, value.includes('tickets.read') ? 'tickets.write' : 'tickets.read'])
        }
      >
        {value.includes('tickets.read') ? 'Add ticket write' : 'Add ticket read'}
      </button>
    </div>
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode; className?: string }) => (
    <section>{children}</section>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
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
    'aria-label'?: string
  }) => (
    <button type={type} disabled={disabled} onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    id,
    value,
    onChange,
    disabled,
    placeholder,
  }: {
    id?: string
    value?: string
    onChange?: (event: { target: { value: string } }) => void
    disabled?: boolean
    placeholder?: string
    maxLength?: number
    autoFocus?: boolean
  }) => (
    <input
      id={id}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onChange?.({ target: { value: event.currentTarget.value } })}
    />
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string; className?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createRoleFn.mockResolvedValue({ id: 'role_1' })
  mocks.deleteRoleFn.mockResolvedValue({ ok: true })
  mocks.setRolePermissionsFn.mockResolvedValue({ ok: true })
  mocks.updateRoleFn.mockResolvedValue({ ok: true })
  mocks.roleDetail = {
    permissionKeys: ['tickets.read'],
  }
})

describe('RoleCreateDialog', () => {
  it('creates a trimmed role, invalidates role data, and closes', async () => {
    const onOpenChange = vi.fn()
    const onCreated = vi.fn()
    render(<RoleCreateDialog open onOpenChange={onOpenChange} onCreated={onCreated} />)

    expect(screen.getByRole('heading', { name: 'Create role' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create role' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Key'), { target: { value: '  custom-role  ' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Custom Role  ' } })
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: '  Can triage tickets  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add ticket read' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }))

    await waitFor(() => {
      expect(mocks.createRoleFn).toHaveBeenCalledWith({
        data: {
          key: 'custom-role',
          name: 'Custom Role',
          description: 'Can triage tickets',
          permissionKeys: ['tickets.read'],
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin', 'roles'] })
    expect(mocks.routerInvalidate).toHaveBeenCalled()
    expect(onCreated).toHaveBeenCalledWith('role_1')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders create failures and resets state when cancelled', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.createRoleFn.mockRejectedValueOnce(new Error('Role key already exists'))
    const onOpenChange = vi.fn()
    render(<RoleCreateDialog open onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'agent' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Agent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }))

    await waitFor(() => {
      expect(screen.getByText('Role key already exists')).toBeInTheDocument()
    })
    expect(console.error).toHaveBeenCalledWith('Failed to create role:', expect.any(Error))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByLabelText('Key')).toHaveValue('')
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })
})

describe('DeleteRoleDialog', () => {
  it('blocks deletion while assignments still reference the role', () => {
    render(
      <DeleteRoleDialog
        open
        onOpenChange={vi.fn()}
        role={{ id: 'role_1' as RoleId, name: 'Agent', assignmentCount: 2 }}
      />
    )

    expect(screen.getByText(/This role has 2 active assignments/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete role' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete role' }))
    expect(mocks.deleteRoleFn).not.toHaveBeenCalled()
  })

  it('deletes unassigned roles and closes the dialog', async () => {
    const onOpenChange = vi.fn()
    render(
      <DeleteRoleDialog
        open
        onOpenChange={onOpenChange}
        role={{ id: 'role_1' as RoleId, name: 'Agent', assignmentCount: 0 }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete role' }))

    await waitFor(() => {
      expect(mocks.deleteRoleFn).toHaveBeenCalledWith({ data: { id: 'role_1' } })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin', 'roles'] })
    expect(mocks.routerInvalidate).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders delete failures and supports cancelling', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.deleteRoleFn.mockRejectedValueOnce('denied')
    const onOpenChange = vi.fn()
    render(
      <DeleteRoleDialog
        open
        onOpenChange={onOpenChange}
        role={{ id: 'role_1' as RoleId, name: 'Agent', assignmentCount: 0 }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete role' }))

    await waitFor(() => {
      expect(screen.getByText('Failed to delete role')).toBeInTheDocument()
    })
    expect(console.error).toHaveBeenCalledWith('Failed to delete role:', 'denied')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('RoleEditDialog', () => {
  it('updates a role with trimmed values and invalidates role data', async () => {
    const onOpenChange = vi.fn()
    render(
      <RoleEditDialog
        open
        onOpenChange={onOpenChange}
        role={{ id: 'role_1' as RoleId, name: 'Agent', description: 'Old description' }}
      />
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Support Agent  ' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mocks.updateRoleFn).toHaveBeenCalledWith({
        data: {
          id: 'role_1',
          name: 'Support Agent',
          description: null,
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin', 'roles'] })
    expect(mocks.routerInvalidate).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders validation and update failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.updateRoleFn.mockRejectedValueOnce(new Error('Name is already taken'))
    render(
      <RoleEditDialog
        open
        onOpenChange={vi.fn()}
        role={{ id: 'role_1' as RoleId, name: 'Agent', description: null }}
      />
    )

    const nameInput = screen.getByLabelText('Name')
    fireEvent.change(nameInput, { target: { value: '   ' } })
    fireEvent.submit(nameInput.closest('form') as HTMLFormElement)
    expect(screen.getByText('Name is required')).toBeInTheDocument()

    fireEvent.change(nameInput, { target: { value: 'Agent 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Name is already taken')).toBeInTheDocument()
    })
    expect(console.error).toHaveBeenCalledWith('Failed to update role:', expect.any(Error))
  })
})

describe('RolePermissionMatrix', () => {
  it('saves changed permission keys and can reset the draft', async () => {
    render(<RolePermissionMatrix roleId={'role_1' as RoleId} isSystem={false} />)

    expect(screen.getByRole('button', { name: 'Save permissions' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Add ticket write' }))
    expect(screen.getByRole('button', { name: 'Save permissions' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }))

    await waitFor(() => {
      expect(mocks.setRolePermissionsFn).toHaveBeenCalledWith({
        data: {
          roleId: 'role_1',
          permissionKeys: ['tickets.read', 'tickets.write'],
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin', 'roles'] })
    expect(mocks.routerInvalidate).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByText('Scopes: tickets.read')).toBeInTheDocument()
  })

  it('renders permission save failures and hides controls for system roles', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.setRolePermissionsFn.mockRejectedValueOnce('denied')
    const { rerender } = render(
      <RolePermissionMatrix roleId={'role_1' as RoleId} isSystem={false} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add ticket write' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }))

    await waitFor(() => {
      expect(screen.getByText('Failed to save permissions')).toBeInTheDocument()
    })
    expect(console.error).toHaveBeenCalledWith('Failed to save permissions:', 'denied')

    rerender(<RolePermissionMatrix roleId={'role_1' as RoleId} isSystem />)
    expect(screen.getByText('Picker disabled')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save permissions' })).not.toBeInTheDocument()
  })
})

describe('RoleList', () => {
  it('renders role metadata, active state, and selection callbacks', () => {
    const onSelect = vi.fn()
    render(
      <RoleList
        selectedId={'role_system' as RoleId}
        onSelect={onSelect}
        roles={[
          {
            id: 'role_system' as RoleId,
            key: 'owner',
            name: 'Owner',
            description: null,
            isSystem: true,
            permissionCount: 7,
            assignmentCount: 1,
          },
          {
            id: 'role_custom' as RoleId,
            key: 'support',
            name: 'Support',
            description: 'Support role',
            isSystem: false,
            permissionCount: 3,
            assignmentCount: 0,
          },
        ]}
      />
    )

    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.getByText('owner')).toBeInTheDocument()
    expect(screen.getByText('7 perms')).toBeInTheDocument()
    expect(screen.getByText('1 assigned')).toBeInTheDocument()
    expect(screen.getByText('Support')).toBeInTheDocument()
    expect(screen.getByText('3 perms')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Support/ }))
    expect(onSelect).toHaveBeenCalledWith('role_custom')
  })
})

describe('RoleDetailPanel', () => {
  it('renders editable role metadata and opens edit/delete dialogs', () => {
    render(
      <RoleDetailPanel
        role={{
          id: 'role_custom' as RoleId,
          key: 'support',
          name: 'Support',
          description: 'Can triage tickets',
          isSystem: false,
          permissionCount: 3,
          assignmentCount: 1,
        }}
      />
    )

    expect(screen.getByRole('heading', { name: 'Support' })).toBeInTheDocument()
    expect(screen.getByText('support')).toBeInTheDocument()
    expect(screen.getByText('1 assignment')).toBeInTheDocument()
    expect(screen.getByText('Can triage tickets')).toBeInTheDocument()
    expect(screen.getByText('Scopes: tickets.read')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Support' }))
    expect(screen.getByRole('heading', { name: 'Edit role' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Support' }))
    expect(screen.getByRole('heading', { name: 'Delete role' })).toBeInTheDocument()
  })

  it('renders system roles as locked and disables destructive controls', () => {
    render(
      <RoleDetailPanel
        role={{
          id: 'role_system' as RoleId,
          key: 'owner',
          name: 'Owner',
          description: null,
          isSystem: true,
          permissionCount: 7,
          assignmentCount: 2,
        }}
      />
    )

    expect(screen.getByText('System')).toBeInTheDocument()
    expect(screen.getByText('2 assignments')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Owner' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete Owner' })).toBeDisabled()
    expect(screen.getByText('Picker disabled')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Edit role' })).not.toBeInTheDocument()
  })
})

describe('RolesSettings', () => {
  it('selects roles and opens the create role dialog', () => {
    render(
      <RolesSettings
        roles={[
          {
            id: 'role_owner' as RoleId,
            key: 'owner',
            name: 'Owner',
            description: null,
            isSystem: true,
            permissionCount: 7,
            assignmentCount: 1,
          },
          {
            id: 'role_support' as RoleId,
            key: 'support',
            name: 'Support',
            description: 'Support role',
            isSystem: false,
            permissionCount: 3,
            assignmentCount: 0,
          },
        ]}
      />
    )

    expect(screen.getAllByText('Owner')).toHaveLength(2)
    expect(screen.getByText('1 assignment')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Support/ }))
    expect(screen.getByRole('heading', { name: 'Support' })).toBeInTheDocument()
    expect(screen.getByText('Support role')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Create role/ }))
    expect(screen.getByRole('heading', { name: 'Create role' })).toBeInTheDocument()
  })

  it('renders an empty selection state when no roles exist', () => {
    render(<RolesSettings roles={[]} />)

    expect(screen.getByText('No role selected.')).toBeInTheDocument()
  })
})
