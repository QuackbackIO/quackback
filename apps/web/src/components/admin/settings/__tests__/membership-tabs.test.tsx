// @vitest-environment happy-dom
import type { ChangeEvent, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { InboxMembersTab } from '../inboxes/inbox-members-tab'
import { TeamMembersTab } from '../teams/team-members-tab'

type QueryOptions<T> = {
  queryKey: readonly unknown[]
  queryFn: () => T
  enabled?: boolean
  staleTime?: number
}

type MutationOptions<TVars, TResult> = {
  mutationFn: (vars: TVars) => Promise<TResult>
  onSuccess?: (result: TResult) => void
  onError?: (error: Error) => void
}

type InboxMembership = {
  id: string
  principalId: string
  role: 'owner' | 'agent' | 'viewer'
}

type TeamMembership = {
  id: string
  principalId: string
  role: 'lead' | 'member'
}

type Principal = {
  id: string
  displayName: string | null
  avatarUrl: string | null
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  addInboxMembershipFn: vi.fn(),
  updateInboxMembershipRoleFn: vi.fn(),
  removeInboxMembershipFn: vi.fn(),
  addTeamMemberFn: vi.fn(),
  removeTeamMemberFn: vi.fn(),
  getPrincipalsByIdsFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  permissionAllowed: true,
  inboxMemberships: [] as InboxMembership[],
  teamMemberships: [] as TeamMembership[],
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useSuspenseQuery: (options: { queryKey: readonly unknown[] }) => {
    const [scope] = options.queryKey
    return {
      data: scope === 'inboxes' ? mocks.inboxMemberships : mocks.teamMemberships,
    }
  },
  useQuery: <T,>(options: QueryOptions<T>) => ({
    data: options.enabled === false ? undefined : options.queryFn(),
  }),
  useMutation: <TVars, TResult>(options: MutationOptions<TVars, TResult>) => ({
    isPending: false,
    mutate: async (vars: TVars) => {
      try {
        const result = await options.mutationFn(vars)
        options.onSuccess?.(result)
      } catch (error) {
        options.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    },
  }),
}))

vi.mock('@/components/admin/shared/permission-gate', () => ({
  PermissionGate: ({
    children,
    fallback = null,
  }: {
    children: ReactNode
    fallback?: ReactNode
    permission: string
  }) => (mocks.permissionAllowed ? <>{children}</> : <>{fallback}</>),
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

vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children }: { children: ReactNode; className?: string }) => <span>{children}</span>,
}))

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({
    children,
    colSpan,
  }: {
    children?: ReactNode
    colSpan?: number
    className?: string
  }) => <td colSpan={colSpan}>{children}</td>,
  TableHead: ({ children }: { children?: ReactNode; className?: string }) => <th>{children}</th>,
  TableHeader: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children }: { children: ReactNode }) => <tr>{children}</tr>,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (value: string) => void
    children: ReactNode
  }) => (
    <select
      aria-label={`select-${value}`}
      value={value}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => onValueChange(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: ReactNode; className?: string }) => <>{children}</>,
  SelectValue: () => null,
}))

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
  AlertDialogTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => <>{children}</>,
}))

vi.mock('@/components/admin/shared/principal-picker', () => ({
  PrincipalPicker: ({
    value,
    onValueChange,
    excludeIds,
    placeholder,
  }: {
    value: string | null
    onValueChange: (value: string | null) => void
    excludeIds: string[]
    placeholder?: string
  }) => (
    <select
      aria-label="Add member"
      value={value ?? ''}
      data-exclude-ids={excludeIds.join(',')}
      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
        onValueChange(event.currentTarget.value || null)
      }
    >
      <option value="">{placeholder ?? 'Pick principal'}</option>
      <option value="principal_new">New principal</option>
      <option value="principal_extra">Extra principal</option>
    </select>
  ),
}))

vi.mock('@heroicons/react/24/outline', () => ({
  TrashIcon: () => <span aria-hidden="true">trash</span>,
}))

vi.mock('@/lib/server/functions/inboxes', () => ({
  addInboxMembershipFn: mocks.addInboxMembershipFn,
  updateInboxMembershipRoleFn: mocks.updateInboxMembershipRoleFn,
  removeInboxMembershipFn: mocks.removeInboxMembershipFn,
}))

vi.mock('@/lib/server/functions/teams', () => ({
  addTeamMemberFn: mocks.addTeamMemberFn,
  removeTeamMemberFn: mocks.removeTeamMemberFn,
}))

vi.mock('@/lib/server/functions/principals', () => ({
  getPrincipalsByIdsFn: mocks.getPrincipalsByIdsFn,
}))

vi.mock('@/lib/client/queries/inboxes', () => ({
  inboxQueries: {
    memberships: (inboxId: string) => ({
      queryKey: ['inboxes', inboxId, 'memberships'],
    }),
  },
}))

vi.mock('@/lib/client/queries/teams', () => ({
  teamQueries: {
    members: (teamId: string) => ({
      queryKey: ['teams', teamId, 'members'],
    }),
  },
}))

vi.mock('@/lib/server/domains/authz', () => ({
  PERMISSIONS: {
    INBOX_MANAGE: 'inbox.manage',
    ADMIN_MANAGE_USERS: 'admin.manage_users',
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.permissionAllowed = true
  mocks.inboxMemberships = [
    { id: 'inbox_member_owner', principalId: 'principal_owner', role: 'owner' },
    { id: 'inbox_member_viewer', principalId: 'principal_viewer', role: 'viewer' },
  ]
  mocks.teamMemberships = [{ id: 'team_member_lead', principalId: 'principal_lead', role: 'lead' }]
  mocks.getPrincipalsByIdsFn.mockImplementation(
    ({ data }: { data: { ids: string[] } }): Principal[] =>
      data.ids.map((id) => ({
        id,
        displayName:
          id === 'principal_owner' ? 'Owner Person' : id === 'principal_lead' ? 'Team Lead' : null,
        avatarUrl: id === 'principal_owner' ? 'https://example.com/avatar.png' : null,
      }))
  )
  mocks.addInboxMembershipFn.mockResolvedValue({ id: 'inbox_member_new' })
  mocks.updateInboxMembershipRoleFn.mockResolvedValue({ id: 'inbox_member_owner' })
  mocks.removeInboxMembershipFn.mockResolvedValue(undefined)
  mocks.addTeamMemberFn.mockResolvedValue({ id: 'team_member_new' })
  mocks.removeTeamMemberFn.mockResolvedValue(undefined)
})

describe('membership tabs', () => {
  it('renders the inbox member table with enriched principals and empty-state fallback', () => {
    render(<InboxMembersTab inboxId={'inbox_support' as never} />)

    expect(mocks.getPrincipalsByIdsFn).toHaveBeenCalledWith({
      data: { ids: ['principal_owner', 'principal_viewer'] },
    })
    expect(screen.getByText('Owner Person')).toBeInTheDocument()
    expect(screen.getByText('principal_viewer')).toBeInTheDocument()
    expect(screen.getByAltText('')).toHaveAttribute('src', 'https://example.com/avatar.png')
    expect(screen.getByLabelText('Add member')).toHaveAttribute(
      'data-exclude-ids',
      'principal_owner,principal_viewer'
    )

    cleanup()
    mocks.inboxMemberships = []
    render(<InboxMembersTab inboxId={'inbox_empty' as never} />)

    expect(screen.getByText('No members yet.')).toBeInTheDocument()
  })

  it('adds, updates and removes inbox members with cache invalidation and toast feedback', async () => {
    render(<InboxMembersTab inboxId={'inbox_support' as never} />)

    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Add member'), {
      target: { value: 'principal_new' },
    })
    fireEvent.change(screen.getByLabelText('select-agent'), { target: { value: 'owner' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(mocks.addInboxMembershipFn).toHaveBeenCalledWith({
        data: {
          inboxId: 'inbox_support',
          principalId: 'principal_new',
          role: 'owner',
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['inboxes', 'inbox_support', 'memberships'],
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Member added')

    fireEvent.change(screen.getByLabelText('select-owner'), { target: { value: 'viewer' } })
    await waitFor(() => {
      expect(mocks.updateInboxMembershipRoleFn).toHaveBeenCalledWith({
        data: {
          membershipId: 'inbox_member_owner',
          role: 'viewer',
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Role updated')

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    await waitFor(() => {
      expect(mocks.removeInboxMembershipFn).toHaveBeenCalledWith({
        data: { membershipId: 'inbox_member_owner' },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Member removed')
  })

  it('shows inbox role fallbacks and surfaces mutation failures when access is denied or rejected', async () => {
    mocks.permissionAllowed = false
    render(<InboxMembersTab inboxId={'inbox_support' as never} />)

    expect(screen.queryByLabelText('Add member')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove member' })).not.toBeInTheDocument()
    expect(screen.getByText('owner')).toBeInTheDocument()
    expect(screen.getByText('viewer')).toBeInTheDocument()

    cleanup()
    mocks.permissionAllowed = true
    mocks.addInboxMembershipFn.mockRejectedValueOnce(new Error('Already a member'))
    render(<InboxMembersTab inboxId={'inbox_support' as never} />)

    fireEvent.change(screen.getByLabelText('Add member'), {
      target: { value: 'principal_extra' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Already a member')
    })
  })

  it('adds, updates and removes team members through the team member tab', async () => {
    render(<TeamMembersTab teamId={'team_support' as never} />)

    expect(mocks.getPrincipalsByIdsFn).toHaveBeenCalledWith({
      data: { ids: ['principal_lead'] },
    })
    expect(screen.getByText('Team Lead')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Add member'), {
      target: { value: 'principal_new' },
    })
    fireEvent.change(screen.getByLabelText('select-member'), { target: { value: 'lead' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(mocks.addTeamMemberFn).toHaveBeenCalledWith({
        data: {
          teamId: 'team_support',
          principalId: 'principal_new',
          role: 'lead',
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['teams', 'team_support', 'members'],
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Member added')

    fireEvent.change(screen.getByLabelText('select-lead'), { target: { value: 'member' } })
    await waitFor(() => {
      expect(mocks.addTeamMemberFn).toHaveBeenCalledWith({
        data: {
          teamId: 'team_support',
          principalId: 'principal_lead',
          role: 'member',
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Role updated')

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => {
      expect(mocks.removeTeamMemberFn).toHaveBeenCalledWith({
        data: {
          teamId: 'team_support',
          principalId: 'principal_lead',
        },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Member removed')
  })

  it('renders team empty and no-permission states and reports mutation failures', async () => {
    mocks.teamMemberships = []
    render(<TeamMembersTab teamId={'team_empty' as never} />)

    expect(screen.getByText('No members yet.')).toBeInTheDocument()
    expect(mocks.getPrincipalsByIdsFn).not.toHaveBeenCalled()

    cleanup()
    mocks.teamMemberships = [
      { id: 'team_member_lead', principalId: 'principal_lead', role: 'lead' },
    ]
    mocks.permissionAllowed = false
    render(<TeamMembersTab teamId={'team_support' as never} />)

    expect(screen.queryByLabelText('Add member')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove member' })).not.toBeInTheDocument()
    expect(screen.getByText('lead')).toBeInTheDocument()

    cleanup()
    mocks.permissionAllowed = true
    mocks.removeTeamMemberFn.mockRejectedValueOnce(new Error('Cannot remove last lead'))
    render(<TeamMembersTab teamId={'team_support' as never} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Cannot remove last lead')
    })
  })
})
