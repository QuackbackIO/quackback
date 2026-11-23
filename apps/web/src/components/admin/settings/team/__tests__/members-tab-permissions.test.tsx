// @vitest-environment happy-dom
/**
 * Member row actions and invitation Resend/Cancel follow member.manage (owner
 * decision D8), as the server functions behind them do, not the legacy admin
 * column. On top, the server's ceiling: only an admin changes or removes an
 * admin, or grants Admin, so a member.manage holder who is not an admin gets
 * no menu on an admin's row and no Admin choice on anyone's.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const teamData = {
  members: [
    {
      id: 'principal_owner',
      userId: 'user_owner',
      userName: 'Ada Owner',
      userEmail: 'ada@example.com',
      role: 'admin',
      assignedRole: null,
      lastSignInAt: null,
    },
    {
      id: 'principal_admin2',
      userId: 'user_admin2',
      userName: 'Bo Admin',
      userEmail: 'bo@example.com',
      role: 'admin',
      assignedRole: null,
      lastSignInAt: null,
    },
    {
      id: 'principal_member',
      userId: 'user_member',
      userName: 'Cy Member',
      userEmail: 'cy@example.com',
      role: 'member',
      assignedRole: null,
      lastSignInAt: null,
    },
    {
      id: 'principal_viewer',
      userId: 'user_viewer',
      userName: 'Di Viewer',
      userEmail: 'di@example.com',
      role: 'member',
      assignedRole: null,
      lastSignInAt: null,
    },
  ],
  avatarMap: {},
  formattedInvitations: [
    {
      id: 'invite_1',
      name: 'Ed Invitee',
      email: 'ed@example.com',
      role: 'member',
      roleName: null,
      createdAt: '2026-11-01T00:00:00.000Z',
      lastSentAt: null,
      expiresAt: '2026-12-01T00:00:00.000Z',
    },
  ],
  seatUsage: { used: 4, limit: 10 },
}

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({ data: teamData }),
  useQueryClient: () => ({}),
}))
vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: { teamMembersAndInvitations: () => ({}) },
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useSessionContext: () => ({ user: { email: 'di@example.com' } }),
  useWorkspaceSettings: () => ({ name: 'Acme' }),
}))
vi.mock('@/components/admin/settings/team/add-people-dialog', () => ({
  AddPeopleDialog: () => null,
}))
vi.mock('@/components/admin/settings/team/cloud-ownership-actions', () => ({
  CloudOwnershipActions: () => null,
}))
vi.mock('@/components/admin/settings/team/member-actions', () => ({
  MemberActions: (props: { principalId: string; canGrantAdmin: boolean }) => (
    <span
      data-testid={`actions-${props.principalId}`}
      data-can-grant-admin={String(props.canGrantAdmin)}
    />
  ),
}))
vi.mock('@/components/admin/settings/team/pending-invitations', async (original) => ({
  ...(await original<typeof import('@/components/admin/settings/team/pending-invitations')>()),
  InvitationActions: (props: { invitation: { id: string } }) => (
    <span data-testid={`invite-actions-${props.invitation.id}`} />
  ),
}))

import { MembersTab } from '../members-tab'

afterEach(cleanup)

function renderAs(role: 'admin' | 'member', canManageMembers: boolean) {
  render(
    <MembersTab
      currentMember={{ id: 'principal_viewer' as never, role, userId: 'user_viewer' as never }}
      canManageMembers={canManageMembers}
    />
  )
}

const menusFor = (principalId: string) => screen.queryAllByTestId(`actions-${principalId}`)

describe('Members tab row actions', () => {
  it('an admin with member.manage acts on every other row and may grant Admin', () => {
    renderAs('admin', true)
    for (const id of ['principal_owner', 'principal_admin2', 'principal_member']) {
      expect(menusFor(id).length).toBeGreaterThan(0)
      for (const menu of menusFor(id)) expect(menu).toHaveAttribute('data-can-grant-admin', 'true')
    }
    expect(menusFor('principal_viewer')).toHaveLength(0)
    expect(screen.queryAllByTestId('invite-actions-invite_1').length).toBeGreaterThan(0)
  })

  it('a custom role with member.manage acts on non-admin rows, never grants Admin', () => {
    renderAs('member', true)
    expect(menusFor('principal_member').length).toBeGreaterThan(0)
    for (const menu of menusFor('principal_member')) {
      expect(menu).toHaveAttribute('data-can-grant-admin', 'false')
    }
    expect(menusFor('principal_owner')).toHaveLength(0)
    expect(menusFor('principal_admin2')).toHaveLength(0)
    expect(menusFor('principal_viewer')).toHaveLength(0)
    expect(screen.queryAllByTestId('invite-actions-invite_1').length).toBeGreaterThan(0)
  })

  it.each([
    ['a Manager (member.view only)', 'member'],
    ['an admin whose role lacks member.manage', 'admin'],
  ] as const)('%s gets no row menus and no Resend or Cancel', (_name, role) => {
    renderAs(role, false)
    for (const id of ['principal_owner', 'principal_admin2', 'principal_member']) {
      expect(menusFor(id)).toHaveLength(0)
    }
    expect(screen.queryAllByTestId('invite-actions-invite_1')).toHaveLength(0)
  })
})
