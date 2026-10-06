// @vitest-environment happy-dom
/**
 * Change role from a person's detail page: the shared role select opened on
 * the role the person holds, saved through changeTeamRoleFn. A refusal comes
 * back as data: a refused grant shows by the field, the rest above the form,
 * in plain words; a failed call never shows raw server text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const fns = vi.hoisted(() => ({
  changeTeamRoleFn: vi.fn(),
  listRolesFn: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/lib/server/functions/team-people', () => ({ changeTeamRoleFn: fns.changeTeamRoleFn }))
vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    roles: () => ({ queryKey: ['settings', 'roles'], queryFn: fns.listRolesFn }),
  },
}))
vi.mock('@/lib/client/hooks/use-users-queries', () => ({ usersKeys: { all: ['users'] } }))
vi.mock('sonner', () => ({ toast: { success: fns.toastSuccess, error: vi.fn() } }))
vi.mock('@/components/ui/select', () => import('./select-double'))

import { ChangeRoleDialog, type ChangeRoleDialogProps } from '../change-role-dialog'

const ROLES = [
  { id: 'role_owner', key: 'owner', name: 'Owner', isSystem: true, permissionKeys: [] },
  { id: 'role_admin', key: 'admin', name: 'Admin', isSystem: true, permissionKeys: [] },
  { id: 'role_manager', key: 'manager', name: 'Manager', isSystem: true, permissionKeys: [] },
  {
    id: 'role_contributor',
    key: 'contributor',
    name: 'Contributor',
    isSystem: true,
    permissionKeys: [],
  },
  { id: 'role_editor', key: 'editor', name: 'Editor', isSystem: false, permissionKeys: [] },
]

beforeEach(() => {
  fns.listRolesFn.mockResolvedValue({ roles: ROLES })
  fns.changeTeamRoleFn.mockResolvedValue({ ok: true, role: 'member', roleId: 'role_editor' })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderDialog(props: Partial<ChangeRoleDialogProps> = {}) {
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChangeRoleDialog
        open
        onOpenChange={onOpenChange}
        principalId="principal_1"
        personName="Maya Chen"
        current={{ role: 'member', label: 'Member' }}
        canGrantAdmin
        {...props}
      />
    </QueryClientProvider>
  )
  return { onOpenChange }
}

const roleField = () => screen.getByLabelText('Role') as HTMLSelectElement
const save = () => screen.getByRole('button', { name: 'Change role' })

describe('ChangeRoleDialog', () => {
  it('saves the new role', async () => {
    const { onOpenChange } = renderDialog()
    expect(screen.getByRole('heading', { name: "Change Maya Chen's role" })).toBeInTheDocument()
    expect(save()).toBeDisabled()

    await screen.findByRole('option', { name: 'Editor' })
    fireEvent.change(roleField(), { target: { value: 'role_editor' } })
    fireEvent.click(save())

    await waitFor(() =>
      expect(fns.changeTeamRoleFn).toHaveBeenCalledWith({
        data: { principalId: 'principal_1', role: 'member', roleId: 'role_editor' },
      })
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(fns.toastSuccess).toHaveBeenCalledWith('Maya Chen is now an Editor.')
  })

  it('opens on a system role outside the presets, listed with the presets', async () => {
    renderDialog({
      current: { role: 'member', roleId: 'role_contributor', label: 'Contributor' },
    })
    expect(roleField()).toHaveValue('role_contributor')
    const presets = screen.getByRole('group', { name: 'Presets' })
    expect(within(presets).getByRole('option', { name: 'Contributor' })).toBeInTheDocument()
    expect(save()).toBeDisabled()

    fireEvent.change(roleField(), { target: { value: 'member' } })
    fireEvent.click(save())
    await waitFor(() =>
      expect(fns.changeTeamRoleFn).toHaveBeenCalledWith({
        data: { principalId: 'principal_1', role: 'member' },
      })
    )
  })

  it('opens on a custom role, listed under Custom', async () => {
    renderDialog({ current: { role: 'member', roleId: 'role_editor', label: 'Editor' } })
    expect(roleField()).toHaveValue('role_editor')
    const custom = await screen.findByRole('group', { name: 'Custom' })
    expect(within(custom).getAllByRole('option', { name: 'Editor' })).toHaveLength(1)
  })

  it('keeps an Admin-tier role out of reach of someone who cannot grant Admin', () => {
    renderDialog({
      current: { role: 'admin', roleId: 'role_admin', label: 'Admin' },
      canGrantAdmin: false,
    })
    expect(roleField()).toHaveValue('role_admin')
    expect(screen.getByRole('option', { name: 'Admin' })).toBeDisabled()
    expect(screen.getByRole('option', { name: /^Admin - / })).toBeDisabled()
  })

  it('warns about Admin', () => {
    renderDialog()
    fireEvent.change(roleField(), { target: { value: 'admin' } })
    expect(
      screen.getByText('Admins can change settings, billing, members and sign-in.')
    ).toBeInTheDocument()
  })

  it('shows a refused grant by the role field', async () => {
    fns.changeTeamRoleFn.mockResolvedValue({
      ok: false,
      code: 'GRANT_CEILING',
      message: 'server words',
    })
    renderDialog()
    fireEvent.change(roleField(), { target: { value: 'admin' } })
    fireEvent.click(save())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can only give a role with no more access than your own.'
    )
    expect(screen.queryByText('server words')).toBeNull()
  })

  it.each([
    ['LAST_ADMIN', 'Maya Chen is the last admin. Make someone else an admin first.'],
    ['CANNOT_MODIFY_SELF', "You can't change your own role."],
    ['SEAT_LIMIT', 'The plan has no seats left for this role.'],
    ['NOT_ELIGIBLE', "Maya Chen can't hold a team role."],
    ['NOT_FOUND', 'Maya Chen is no longer on the team.'],
  ])('says plainly why %s was refused', async (code, copy) => {
    fns.changeTeamRoleFn.mockResolvedValue({ ok: false, code, message: 'server words' })
    renderDialog()
    fireEvent.change(roleField(), { target: { value: 'admin' } })
    fireEvent.click(save())
    expect(await screen.findByText(copy)).toBeInTheDocument()
    expect(screen.queryByText('server words')).toBeNull()
    expect(fns.toastSuccess).not.toHaveBeenCalled()
  })

  it('shows a generic message when the call fails', async () => {
    fns.changeTeamRoleFn.mockRejectedValue(new Error('{"status":500,"unhandled":true}'))
    renderDialog()
    fireEvent.change(roleField(), { target: { value: 'admin' } })
    fireEvent.click(save())
    expect(await screen.findByText("Couldn't change the role. Try again.")).toBeInTheDocument()
    expect(screen.queryByText(/unhandled/)).toBeNull()
  })
})
