// @vitest-environment happy-dom
/**
 * The members page is gated on member.view, but its Teams tab lists teams, a
 * read gated on team.manage. A role holding the first without the second (the
 * built-in Manager) must still get the page: the reads it may make warmed, the
 * one it may not left out, and the tab that needs it not offered.
 *
 * The page's server reads are stood in for by functions that enforce the gate
 * the real function declares, read off its source by the authorization
 * scanner, so a read the loader warms for a role that cannot make it fails
 * here exactly as it fails in production.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS } from '@/lib/shared/permissions'
import { scanSourceFile } from '@/lib/server/policy/authz-matrix/scan'

const { held, gates, reads } = vi.hoisted(() => ({
  held: { permissions: new Set<string>() as ReadonlySet<string> },
  /** Server function name -> the permission its gate enforces. */
  gates: new Map<string, string>(),
  reads: [] as string[],
}))

function gated<T>(name: string, value: T) {
  return async () => {
    const permission = gates.get(name)
    if (!permission) throw new Error(`no scanned gate for ${name}`)
    if (!held.permissions.has(permission)) {
      throw new Error(`Access denied: Requires permission '${permission}'`)
    }
    reads.push(name)
    return value
  }
}

vi.mock('@/lib/server/functions/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/settings')>()),
  fetchTeamMembersAndInvitations: gated('fetchTeamMembersAndInvitations', {
    members: [],
    invitations: [],
  }),
}))
vi.mock('@/lib/server/functions/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/teams')>()),
  listTeamsAdminFn: gated('listTeamsAdminFn', []),
}))
vi.mock('@/lib/server/functions/roles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/roles')>()),
  listRolesFn: gated('listRolesFn', { roles: [], maxCustomRoles: null }),
}))

vi.mock('@/components/ui/back-link', () => ({ BackLink: () => null }))
vi.mock('@/components/admin/settings/team/members-tab', () => ({
  MembersTab: () => <p>members roster</p>,
}))
vi.mock('@/components/admin/settings/teams/teams-tab', () => ({
  TeamsTab: () => <p>teams list</p>,
}))
vi.mock('@/components/admin/settings/team/roles-tab', () => ({
  RolesTab: () => <p>roles list</p>,
}))

const { Route } = await import('../admin/settings.members')

const SRC_ROOT = join(__dirname, '../..')
for (const file of ['settings', 'teams', 'roles']) {
  const rel = `lib/server/functions/${file}.ts`
  for (const gate of scanSourceFile(rel, readFileSync(join(SRC_ROOT, rel), 'utf8')).gates) {
    if (gate.authz.kind !== 'permission' || !gate.authz.permissionConst) continue
    const key = gate.authz.permissionConst as keyof typeof PERMISSIONS
    gates.set(gate.surface, PERMISSIONS[key])
  }
}

type Loader = (ctx: { context: Record<string, unknown> }) => Promise<Record<string, unknown>>
const loader = (Route as unknown as { options: { loader: Loader } }).options.loader
const Page = (Route as unknown as { options: { component: () => React.ReactNode } }).options
  .component

/** The built-in roles' real grants: Manager holds member.view but not team.manage. */
const MANAGER = new Set<string>(SYSTEM_ROLE_PERMISSIONS.manager)
const OWNER = new Set<string>(SYSTEM_ROLE_PERMISSIONS.owner)

function runLoader(permissions: ReadonlySet<string>) {
  held.permissions = permissions
  return loader({
    context: {
      queryClient: new QueryClient(),
      permissions: [...permissions],
      settings: { name: 'Acme' },
      principal: { id: 'principal_1', role: 'member', userId: 'user_1' },
    },
  })
}

function renderPage(loaderData: Record<string, unknown>, tab?: string) {
  vi.spyOn(Route, 'useLoaderData').mockReturnValue(loaderData as never)
  vi.spyOn(Route, 'useSearch').mockReturnValue({ tab } as never)
  vi.spyOn(Route, 'useNavigate').mockReturnValue(vi.fn() as never)
  return render(<Page />)
}

beforeEach(() => {
  reads.length = 0
  vi.restoreAllMocks()
})

describe('members settings page', () => {
  it('stands in for each read with the gate the real server function declares', () => {
    expect(gates.get('listTeamsAdminFn')).toBe(PERMISSIONS.TEAM_MANAGE)
    expect(gates.get('listRolesFn')).toBe(PERMISSIONS.MEMBER_VIEW)
    expect(gates.get('fetchTeamMembersAndInvitations')).toBe(PERMISSIONS.MEMBER_VIEW)
    expect(MANAGER.has(PERMISSIONS.MEMBER_VIEW)).toBe(true)
    expect(MANAGER.has(PERMISSIONS.TEAM_MANAGE)).toBe(false)
  })

  it('loads for a Manager, warming the roster and roles but not the teams it cannot read', async () => {
    const data = await runLoader(MANAGER)
    expect(reads.sort()).toEqual(['fetchTeamMembersAndInvitations', 'listRolesFn'])
    expect(data.canManageTeams).toBe(false)
  })

  it('warms the teams too for a role that may manage them', async () => {
    const data = await runLoader(OWNER)
    expect(reads.sort()).toEqual([
      'fetchTeamMembersAndInvitations',
      'listRolesFn',
      'listTeamsAdminFn',
    ])
    expect(data.canManageTeams).toBe(true)
  })

  it('does not offer a Manager the Teams tab, even from a link to it', async () => {
    const data = await runLoader(MANAGER)
    renderPage(data, 'teams')
    expect(screen.queryByRole('tab', { name: 'Teams' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Roles' })).toBeInTheDocument()
    expect(screen.queryByText('teams list')).not.toBeInTheDocument()
    expect(screen.getByText('members roster')).toBeInTheDocument()
  })

  it('offers the Teams tab to a role that may manage teams', async () => {
    const data = await runLoader(OWNER)
    renderPage(data, 'teams')
    expect(screen.getByRole('tab', { name: 'Teams' })).toBeInTheDocument()
    expect(screen.getByText('teams list')).toBeInTheDocument()
  })
})
