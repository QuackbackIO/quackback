// @vitest-environment happy-dom
import type { ChangeEvent, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ManagePrincipalRolesDialog } from '../manage-principal-roles-dialog'

type Assignment = {
  id: string
  role: {
    id: string
    name: string
    key: string
    isSystem: boolean
  }
  teamName: string | null
}

type Role = {
  id: string
  name: string
  key: string
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  routerInvalidate: vi.fn(),
  listAssignmentsForPrincipalFn: vi.fn(),
  listRolesFn: vi.fn(),
  assignRoleFn: vi.fn(),
  revokeRoleAssignmentFn: vi.fn(),
  assignments: [] as Assignment[],
  roles: [] as Role[],
  assignmentsLoading: false,
  rolesLoading: false,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useQuery: (options: {
    queryKey: readonly unknown[]
    queryFn: () => unknown
    enabled?: boolean
  }) => {
    if (options.enabled === false) {
      return { data: undefined, isLoading: false }
    }
    const [, kind] = options.queryKey
    if (kind === 'principal-roles') {
      options.queryFn()
      return { data: mocks.assignments, isLoading: mocks.assignmentsLoading }
    }
    options.queryFn()
    return { data: mocks.roles, isLoading: mocks.rolesLoading }
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    invalidate: mocks.routerInvalidate,
  }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    children: ReactNode
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode; className?: string }) => (
    <section role="dialog">{children}</section>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
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

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode; variant?: string; className?: string }) => (
    <span>{children}</span>
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: { children: ReactNode; className?: string }) => <label>{children}</label>,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string
    onValueChange: (value: string) => void
    disabled?: boolean
    children: ReactNode
  }) => (
    <select
      aria-label="Role"
      value={value}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => onValueChange(event.currentTarget.value)}
    >
      <option value="">Pick a role</option>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <>{placeholder}</>,
}))

vi.mock('@/components/admin/shared/team-picker', () => ({
  TeamPicker: ({
    value,
    onValueChange,
    disabled,
    placeholder,
  }: {
    value: string | null
    onValueChange: (value: string | null) => void
    placeholder?: string
    allowClear?: boolean
    disabled?: boolean
  }) => (
    <select
      aria-label="Team"
      value={value ?? ''}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
        onValueChange(event.currentTarget.value || null)
      }
    >
      <option value="">{placeholder ?? 'Workspace-wide'}</option>
      <option value="team_support">Support</option>
    </select>
  ),
}))

vi.mock('@heroicons/react/24/outline', () => ({
  TrashIcon: () => <span aria-hidden="true">trash</span>,
}))

vi.mock('@/lib/server/functions/roles', () => ({
  listAssignmentsForPrincipalFn: mocks.listAssignmentsForPrincipalFn,
  listRolesFn: mocks.listRolesFn,
  assignRoleFn: mocks.assignRoleFn,
  revokeRoleAssignmentFn: mocks.revokeRoleAssignmentFn,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.assignmentsLoading = false
  mocks.rolesLoading = false
  mocks.assignments = [
    {
      id: 'assignment_owner',
      role: {
        id: 'role_owner',
        name: 'Owner',
        key: 'owner',
        isSystem: true,
      },
      teamName: null,
    },
    {
      id: 'assignment_agent',
      role: {
        id: 'role_agent',
        name: 'Agent',
        key: 'agent',
        isSystem: false,
      },
      teamName: 'Support',
    },
  ]
  mocks.roles = [
    { id: 'role_admin', name: 'Admin', key: 'admin' },
    { id: 'role_agent', name: 'Agent', key: 'agent' },
  ]
  mocks.listAssignmentsForPrincipalFn.mockResolvedValue(mocks.assignments)
  mocks.listRolesFn.mockResolvedValue(mocks.roles)
  mocks.assignRoleFn.mockResolvedValue({ id: 'assignment_new' })
  mocks.revokeRoleAssignmentFn.mockResolvedValue(undefined)
})

function renderDialog(open = true) {
  return render(
    <ManagePrincipalRolesDialog
      open={open}
      onOpenChange={vi.fn()}
      principalId={'principal_1' as never}
      principalName="Ada Admin"
    />
  )
}

describe('ManagePrincipalRolesDialog', () => {
  it('does not render dialog content while closed', () => {
    renderDialog(false)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.listAssignmentsForPrincipalFn).not.toHaveBeenCalled()
    expect(mocks.listRolesFn).not.toHaveBeenCalled()
  })

  it('renders loading, empty and populated grant states', () => {
    mocks.assignmentsLoading = true
    mocks.rolesLoading = true
    mocks.assignments = []
    renderDialog()

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.getByLabelText('Role')).toBeDisabled()
    expect(mocks.listAssignmentsForPrincipalFn).toHaveBeenCalledWith({
      data: { principalId: 'principal_1' },
    })
    expect(mocks.listRolesFn).toHaveBeenCalled()

    mocks.assignmentsLoading = false
    mocks.rolesLoading = false
    mocks.assignments = []
    const { rerender } = renderDialog()
    expect(screen.getByText('No role grants yet.')).toBeInTheDocument()

    mocks.assignments = [
      {
        id: 'assignment_owner',
        role: { id: 'role_owner', name: 'Owner', key: 'owner', isSystem: true },
        teamName: null,
      },
    ]
    rerender(
      <ManagePrincipalRolesDialog
        open
        onOpenChange={vi.fn()}
        principalId={'principal_1' as never}
        principalName="Ada Admin"
      />
    )
    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.getByText('System')).toBeInTheDocument()
    expect(screen.getByText('Workspace')).toBeInTheDocument()
  })

  it('grants scoped roles, resets selections and invalidates RBAC queries', async () => {
    renderDialog()

    expect(screen.getByRole('button', { name: 'Grant role' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'role_admin' } })
    fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'team_support' } })
    fireEvent.click(screen.getByRole('button', { name: 'Grant role' }))

    await waitFor(() => {
      expect(mocks.assignRoleFn).toHaveBeenCalledWith({
        data: {
          principalId: 'principal_1',
          roleId: 'role_admin',
          teamId: 'team_support',
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['admin', 'principal-roles', 'principal_1'],
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin', 'roles'] })
    expect(mocks.routerInvalidate).toHaveBeenCalled()
    expect(screen.getByLabelText('Role')).toHaveValue('')
    expect(screen.getByLabelText('Team')).toHaveValue('')
  })

  it('revokes grants and reports grant/revoke errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.assignRoleFn.mockRejectedValueOnce(new Error('Grant denied'))
    mocks.revokeRoleAssignmentFn.mockRejectedValueOnce(new Error('Revoke denied'))

    renderDialog()

    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'role_admin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Grant role' }))
    await waitFor(() => {
      expect(screen.getByText('Grant denied')).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0])
    await waitFor(() => {
      expect(mocks.revokeRoleAssignmentFn).toHaveBeenCalledWith({
        data: { assignmentId: 'assignment_owner' },
      })
    })
    expect(screen.getByText('Revoke denied')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0])
    await waitFor(() => {
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['admin', 'principal-roles', 'principal_1'],
      })
    })
    consoleError.mockRestore()
  })
})
