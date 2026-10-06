// @vitest-environment happy-dom
/**
 * Change role from a person's detail page: the shared role select, saved
 * through updateMemberRoleFn, with a refused grant shown by the field.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Children, isValidElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const fns = vi.hoisted(() => ({
  updateMemberRoleFn: vi.fn(),
  listRolesFn: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/lib/server/functions/admin', () => ({ updateMemberRoleFn: fns.updateMemberRoleFn }))
vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    roles: () => ({ queryKey: ['settings', 'roles'], queryFn: fns.listRolesFn }),
  },
}))
vi.mock('@/lib/client/hooks/use-users-queries', () => ({ usersKeys: { all: ['users'] } }))
vi.mock('sonner', () => ({ toast: { success: fns.toastSuccess, error: vi.fn() } }))
vi.mock('@/components/ui/select', () => {
  function collect(node: ReactNode): ReactNode {
    return Children.map(node, (child) => {
      if (!isValidElement(child)) return null
      const props = child.props as { value?: string; disabled?: boolean; children?: ReactNode }
      if (child.type === SelectItem) {
        return (
          <option value={props.value} disabled={props.disabled}>
            {props.children}
          </option>
        )
      }
      if (child.type === SelectLabel) return null
      return collect(props.children)
    })
  }
  function Select(props: {
    value: string
    onValueChange: (v: string) => void
    children: ReactNode
  }) {
    let id: string | undefined
    let content: ReactNode = null
    Children.forEach(props.children, (child) => {
      if (!isValidElement(child)) return
      if (child.type === SelectTrigger) id = (child.props as { id?: string }).id
      if (child.type === SelectContent) content = (child.props as { children?: ReactNode }).children
    })
    return (
      <select id={id} value={props.value} onChange={(e) => props.onValueChange(e.target.value)}>
        {collect(content)}
      </select>
    )
  }
  const SelectTrigger = (_: { id?: string; children?: ReactNode }) => null
  const SelectContent = (_: { children?: ReactNode }) => null
  const SelectLabel = (_: { children?: ReactNode }) => null
  const SelectItem = (_: { value: string; disabled?: boolean; children?: ReactNode }) => null
  const SelectGroup = ({ children }: { children?: ReactNode }) => <>{children}</>
  return {
    Select,
    SelectTrigger,
    SelectContent,
    SelectGroup,
    SelectLabel,
    SelectItem,
    SelectValue: () => null,
  }
})

import { ChangeRoleDialog } from '../change-role-dialog'

beforeEach(() => {
  fns.listRolesFn.mockResolvedValue({
    roles: [{ id: 'role_editor', name: 'Editor', isSystem: false, permissionKeys: [] }],
  })
  fns.updateMemberRoleFn.mockResolvedValue({ success: true })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderDialog(canGrantAdmin = true) {
  const onChanged = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChangeRoleDialog
        open
        onOpenChange={onOpenChange}
        principalId="principal_1"
        personName="Maya Chen"
        current={{ role: 'member' }}
        canGrantAdmin={canGrantAdmin}
        onChanged={onChanged}
      />
    </QueryClientProvider>
  )
  return { onChanged, onOpenChange }
}

describe('ChangeRoleDialog', () => {
  it('saves the new role and reports it', async () => {
    const { onChanged, onOpenChange } = renderDialog()
    expect(screen.getByRole('heading', { name: "Change Maya Chen's role" })).toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Change role' })
    expect(save).toBeDisabled()

    await screen.findByRole('option', { name: 'Editor' })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'role_editor' } })
    fireEvent.click(save)

    await waitFor(() =>
      expect(fns.updateMemberRoleFn).toHaveBeenCalledWith({
        data: { principalId: 'principal_1', role: 'member', roleId: 'role_editor' },
      })
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onChanged).toHaveBeenCalledWith({
      role: 'member',
      roleId: 'role_editor',
      label: 'Editor',
    })
    expect(fns.toastSuccess).toHaveBeenCalledWith('Maya Chen is now an Editor.')
  })

  it('warns about Admin, and offers it only to someone who can grant it', () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'admin' } })
    expect(
      screen.getByText('Admins can change settings, billing, members and sign-in.')
    ).toBeInTheDocument()
    cleanup()
    renderDialog(false)
    expect(screen.getByRole('option', { name: /^Admin - / })).toBeDisabled()
  })

  it('shows a refused grant by the role field', async () => {
    fns.updateMemberRoleFn.mockRejectedValue(
      Object.assign(new Error('nope'), { code: 'GRANT_CEILING' })
    )
    renderDialog()
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change role' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can only give a role with no more access than your own.'
    )
  })
})
