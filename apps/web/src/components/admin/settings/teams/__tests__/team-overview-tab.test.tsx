// @vitest-environment happy-dom
import type { ChangeEvent, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TeamOverviewTab } from '../team-overview-tab'

type TeamProp = Parameters<typeof TeamOverviewTab>[0]['team']

type MutationOptions<T> = {
  mutationFn: () => Promise<T>
  onSuccess?: (result: T) => void
  onError?: (error: Error) => void
}

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  updateTeamFn: vi.fn(),
  archiveTeamFn: vi.fn(),
  unarchiveTeamFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  permissionAllowed: true,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
  useMutation: <T,>(options: MutationOptions<T>) => ({
    isPending: false,
    mutate: async () => {
      try {
        const result = await options.mutationFn()
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
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    type?: 'button' | 'submit' | 'reset'
    variant?: string
    size?: string
  }) => (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    id,
    type = 'text',
    value,
    onChange,
    disabled,
    readOnly,
    placeholder,
  }: {
    id?: string
    type?: string
    value?: string
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void
    disabled?: boolean
    readOnly?: boolean
    required?: boolean
    maxLength?: number
    placeholder?: string
    className?: string
  }) => (
    <input
      id={id}
      type={type}
      value={value}
      onChange={onChange}
      disabled={disabled}
      readOnly={readOnly}
      placeholder={placeholder}
    />
  ),
}))

vi.mock('@/components/ui/textarea', () => ({
  Textarea: ({
    id,
    value,
    onChange,
    rows,
  }: {
    id?: string
    value?: string
    onChange?: (event: ChangeEvent<HTMLTextAreaElement>) => void
    rows?: number
    maxLength?: number
  }) => <textarea id={id} value={value} onChange={onChange} rows={rows} />,
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
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

vi.mock('@/lib/server/functions/teams', () => ({
  updateTeamFn: mocks.updateTeamFn,
  archiveTeamFn: mocks.archiveTeamFn,
  unarchiveTeamFn: mocks.unarchiveTeamFn,
}))

vi.mock('@/lib/client/queries/teams', () => ({
  teamQueries: {
    detail: (teamId: string) => ({ queryKey: ['teams', 'detail', teamId] }),
  },
}))

vi.mock('@/lib/server/domains/authz', () => ({
  PERMISSIONS: {
    ADMIN_MANAGE_USERS: 'admin.manage_users',
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

function team(overrides: Partial<TeamProp> = {}): TeamProp {
  return {
    id: 'team_support',
    slug: 'support',
    name: 'Support',
    description: 'Handles tickets',
    shortLabel: 'SUP',
    color: '#22c55e',
    archivedAt: null,
    ...overrides,
  } as TeamProp
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.permissionAllowed = true
  mocks.updateTeamFn.mockResolvedValue({ id: 'team_support' })
  mocks.archiveTeamFn.mockResolvedValue({ id: 'team_support' })
  mocks.unarchiveTeamFn.mockResolvedValue({ id: 'team_support' })
})

describe('TeamOverviewTab', () => {
  it('saves trimmed team fields, invalidates detail/list queries and shows success', async () => {
    render(<TeamOverviewTab team={team()} />)

    expect(screen.getByDisplayValue('support')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Success  ' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('Short label'), { target: { value: '  CS  ' } })
    fireEvent.change(screen.getByPlaceholderText('#6366f1'), { target: { value: '  #6366f1  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mocks.updateTeamFn).toHaveBeenCalledWith({
        data: {
          teamId: 'team_support',
          name: 'Success',
          description: null,
          shortLabel: 'CS',
          color: '#6366f1',
        },
      })
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['teams', 'detail', 'team_support'],
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['teams'] })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Team updated')
  })

  it('validates name and reports save failures', async () => {
    render(<TeamOverviewTab team={team()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(mocks.toastError).toHaveBeenCalledWith('Name is required')
    expect(mocks.updateTeamFn).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Support' } })
    mocks.updateTeamFn.mockRejectedValueOnce(new Error('Duplicate team'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Duplicate team')
    })
  })

  it('resets editable fields when the team prop changes', () => {
    const { rerender } = render(<TeamOverviewTab team={team()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved' } })
    expect(screen.getByLabelText('Name')).toHaveValue('Unsaved')

    rerender(
      <TeamOverviewTab
        team={team({
          id: 'team_sales',
          slug: 'sales',
          name: 'Sales',
          description: null,
          shortLabel: null,
          color: null,
        })}
      />
    )

    expect(screen.getByDisplayValue('sales')).toBeDisabled()
    expect(screen.getByLabelText('Name')).toHaveValue('Sales')
    expect(screen.getByLabelText('Description')).toHaveValue('')
    expect(screen.getByLabelText('Short label')).toHaveValue('')
    expect(screen.getByLabelText('Color')).toHaveValue('#6366f1')
  })

  it('archives and unarchives teams and reports archive failures', async () => {
    const { rerender } = render(<TeamOverviewTab team={team()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await waitFor(() => {
      expect(mocks.archiveTeamFn).toHaveBeenCalledWith({
        data: { teamId: 'team_support' },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Team archived')

    mocks.archiveTeamFn.mockRejectedValueOnce(new Error('Archive denied'))
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Archive denied')
    })

    rerender(<TeamOverviewTab team={team({ archivedAt: new Date('2026-06-01T00:00:00.000Z') })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive team' }))
    await waitFor(() => {
      expect(mocks.unarchiveTeamFn).toHaveBeenCalledWith({
        data: { teamId: 'team_support' },
      })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Team unarchived')

    mocks.unarchiveTeamFn.mockRejectedValueOnce(new Error('Unarchive denied'))
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive team' }))
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Unarchive denied')
    })
  })

  it('hides mutation controls when user management permission is denied', () => {
    mocks.permissionAllowed = false

    render(<TeamOverviewTab team={team()} />)

    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive team' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Support')
  })
})
