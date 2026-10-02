// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RolesTab } from '../roles-tab'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children: React.ReactNode
    to: string
    params?: Record<string, string>
  }) => (
    <a href={params ? to.replace('$roleId', params.roleId) : to} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/client/use-permissions', () => ({
  useHasPermission: () => true,
}))

vi.mock('@/lib/server/functions/roles', () => ({ listRolesFn: vi.fn() }))

const ROLES = {
  maxCustomRoles: null,
  roles: [
    {
      id: 'role_owner',
      key: 'owner',
      name: 'Owner',
      description: 'Everything',
      isSystem: true,
      permissionKeys: new Array(88).fill('k'),
      memberCount: 1,
      newPermissionKeys: [],
    },
    {
      id: 'role_lead',
      key: 'role_lead',
      name: 'Support Lead',
      description: '',
      isSystem: false,
      permissionKeys: new Array(12).fill('k'),
      memberCount: 3,
      newPermissionKeys: [],
    },
  ],
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['settings', 'roles'], ROLES)
  return render(
    <QueryClientProvider client={client}>
      <RolesTab />
    </QueryClientProvider>
  )
}

describe('RolesTab', () => {
  afterEach(cleanup)

  it('offers exactly one New role action, with a plus icon', () => {
    renderTab()
    const buttons = screen.getAllByText(/new role/i)
    expect(buttons).toHaveLength(1)
    expect(buttons[0].closest('button')?.querySelector('svg')).not.toBeNull()
  })

  it('lists roles as link rows, with no badge on presets, and the permission count as meta', () => {
    renderTab()
    const rows = document.querySelectorAll('[data-slot="settings-list-row"]')
    expect(rows).toHaveLength(2)

    const owner = rows[0] as HTMLElement
    expect(owner.tagName).toBe('A')
    expect(owner.getAttribute('href')).toBe('/admin/settings/members/roles/role_owner')
    expect(within(owner).queryByText('Preset')).toBeNull()
    expect(within(owner).getByText(/88 permissions/)).toBeInTheDocument()

    const custom = rows[1] as HTMLElement
    expect(within(custom).queryByText('Preset')).toBeNull()
    expect(within(custom).queryByText('Custom')).toBeNull()
    expect(within(custom).getByText(/12 permissions/)).toBeInTheDocument()
  })

  it('shows a role description as the row meta, with the permission count', () => {
    renderTab()
    const rows = document.querySelectorAll('[data-slot="settings-list-row"]')
    expect((rows[0] as HTMLElement).textContent).toMatch(/Everything · 88 permissions/)
    // An empty description adds no separator.
    expect((rows[1] as HTMLElement).textContent).not.toMatch(/^\s*·|· ·/)
  })
})
