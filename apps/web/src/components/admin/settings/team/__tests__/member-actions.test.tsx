// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemberActions } from '../member-actions'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  updateMemberRoleFn: vi.fn(),
  removeTeamMemberFn: vi.fn(),
  forceSignOutUserFn: vi.fn(),
  adminResetTwoFactorFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  alert: vi.fn(),
  consoleError: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

vi.mock('@/lib/server/functions/admin', () => ({
  updateMemberRoleFn: mocks.updateMemberRoleFn,
  removeTeamMemberFn: mocks.removeTeamMemberFn,
  forceSignOutUserFn: mocks.forceSignOutUserFn,
}))

vi.mock('@/lib/server/functions/admin-reset-two-factor', () => ({
  adminResetTwoFactorFn: mocks.adminResetTwoFactorFn,
}))

vi.mock('../manage-principal-roles-dialog', () => ({
  ManagePrincipalRolesDialog: ({
    open,
    onOpenChange,
    principalId,
    principalName,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    principalId: string
    principalName: string
  }) =>
    open ? (
      <section>
        Manage roles for {principalName} ({principalId})
        <button type="button" onClick={() => onOpenChange(false)}>
          Close roles
        </button>
      </section>
    ) : null,
}))

vi.mock('@/components/shared/confirm-dialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    description,
    confirmLabel,
    onConfirm,
    onOpenChange,
  }: {
    open: boolean
    title: string
    description: ReactNode
    confirmLabel: string
    variant?: string
    isPending?: boolean
    onConfirm: () => void | Promise<void>
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <section role="alertdialog">
        <h2>{title}</h2>
        <p>{description}</p>
        <button type="button" onClick={() => void onConfirm()}>
          {confirmLabel}
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close confirm
        </button>
      </section>
    ) : null,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    variant?: string
    size?: string
    className?: string
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
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
    disabled,
    onClick,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
    variant?: string
    className?: string
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => (
    <>{children}</>
  ),
}))

vi.mock('@heroicons/react/24/solid', () => ({
  ArrowRightOnRectangleIcon: () => <span aria-hidden="true">signout</span>,
  EllipsisVerticalIcon: () => <span aria-hidden="true">menu</span>,
  ShieldCheckIcon: () => <span aria-hidden="true">admin</span>,
  ShieldExclamationIcon: () => <span aria-hidden="true">2fa</span>,
  UserIcon: () => <span aria-hidden="true">user</span>,
  UserMinusIcon: () => <span aria-hidden="true">remove</span>,
}))

vi.mock('@heroicons/react/24/outline', () => ({
  KeyIcon: () => <span aria-hidden="true">key</span>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateMemberRoleFn.mockResolvedValue(undefined)
  mocks.removeTeamMemberFn.mockResolvedValue(undefined)
  mocks.forceSignOutUserFn.mockResolvedValue({ revokeCount: 2 })
  mocks.adminResetTwoFactorFn.mockResolvedValue(undefined)
  mocks.invalidateQueries.mockResolvedValue(undefined)
  vi.stubGlobal('alert', mocks.alert)
  vi.spyOn(console, 'error').mockImplementation(mocks.consoleError)
})

describe('MemberActions', () => {
  it('runs member administration actions and invalidates team queries', async () => {
    render(
      <MemberActions
        principalId="principal_1"
        userId="user_1"
        memberName="Ada"
        memberRole="member"
        isLastAdmin={false}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Make admin/ }))
    expect(screen.getByRole('heading', { name: 'Make admin?' })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Make admin' }).at(-1)!)
    await waitFor(() => {
      expect(mocks.updateMemberRoleFn).toHaveBeenCalledWith({
        data: { principalId: 'principal_1', role: 'admin' },
      })
    })

    fireEvent.click(screen.getByRole('button', { name: /Manage roles/ }))
    expect(screen.getByText(/Manage roles for Ada/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close roles' }))
    expect(screen.queryByText(/Manage roles for Ada/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Reset two-factor/ }))
    expect(
      screen.getByRole('heading', { name: 'Reset two-factor authentication?' })
    ).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset two-factor' }).at(-1)!)
    await waitFor(() => {
      expect(mocks.adminResetTwoFactorFn).toHaveBeenCalledWith({ data: { userId: 'user_1' } })
    })

    fireEvent.click(screen.getByRole('button', { name: /Sign out everywhere/ }))
    expect(screen.getByRole('heading', { name: 'Sign out everywhere?' })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out everywhere' }).at(-1)!)
    await waitFor(() => {
      expect(mocks.forceSignOutUserFn).toHaveBeenCalledWith({ data: { userId: 'user_1' } })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Signed Ada out of 2 sessions.')

    fireEvent.click(screen.getAllByRole('button', { name: /Remove from team/ })[0])
    expect(screen.getByRole('heading', { name: 'Remove team member?' })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove from team' }).at(-1)!)
    await waitFor(() => {
      expect(mocks.removeTeamMemberFn).toHaveBeenCalledWith({
        data: { principalId: 'principal_1' },
      })
    })

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['settings', 'team'] })
  })

  it('handles admin demotion, one-session signout copy, and service errors', async () => {
    mocks.forceSignOutUserFn.mockResolvedValueOnce({ revokeCount: 1 })
    mocks.updateMemberRoleFn.mockRejectedValueOnce(new Error('cannot demote'))
    const { rerender } = render(
      <MemberActions
        principalId="principal_2"
        userId="user_2"
        memberName="Grace"
        memberRole="admin"
        isLastAdmin={false}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Make member/ }))
    expect(screen.getByRole('heading', { name: 'Remove admin privileges?' })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove admin' }).at(-1)!)
    await waitFor(() => {
      expect(mocks.alert).toHaveBeenCalledWith('cannot demote')
    })

    fireEvent.click(screen.getByRole('button', { name: /Sign out everywhere/ }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out everywhere' }).at(-1)!)
    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Signed Grace out of 1 session.')
    })

    mocks.forceSignOutUserFn.mockRejectedValueOnce(new Error('session revoke failed'))
    fireEvent.click(screen.getByRole('button', { name: /Sign out everywhere/ }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out everywhere' }).at(-1)!)
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('session revoke failed')
    })

    rerender(
      <MemberActions
        principalId="principal_3"
        userId={null}
        memberName="Linus"
        memberRole="admin"
        isLastAdmin
      />
    )

    expect(screen.getByRole('button', { name: /Make member/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Remove from team/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Reset two-factor/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Sign out everywhere/ })).not.toBeInTheDocument()
  })
})
