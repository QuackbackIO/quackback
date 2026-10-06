// @vitest-environment happy-dom
/**
 * The members table shows a date whose format switches once the page has
 * hydrated. The switch must re-render only the date labels: a formatter in the
 * columns memo would rebuild every column and re-render every row.
 */
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatIn, restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import { MembersTab } from '../members-tab'

const OLD_SIGN_IN = '2026-01-05T20:30:00.000Z'
const VIEWER = { locale: 'de-DE', timeZone: 'Pacific/Kiritimati' }

const { rowRenders } = vi.hoisted(() => ({ rowRenders: { current: 0 } }))

const teamData = {
  members: [
    {
      id: 'principal_admin',
      userId: 'user_admin',
      userName: 'Ada Admin',
      userEmail: 'ada@example.com',
      role: 'admin',
      assignedRole: null,
      lastSignInAt: OLD_SIGN_IN,
    },
    {
      id: 'principal_mate',
      userId: 'user_mate',
      userName: 'Max Mate',
      userEmail: 'max@example.com',
      role: 'member',
      assignedRole: null,
      lastSignInAt: OLD_SIGN_IN,
    },
  ],
  avatarMap: {},
  formattedInvitations: [],
  seatUsage: null,
}

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({ data: teamData }),
  useQueryClient: () => ({}),
}))
vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: { teamMembersAndInvitations: () => ({}) },
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useSessionContext: () => ({ user: { email: 'ada@example.com' } }),
  useWorkspaceSettings: () => ({ name: 'Acme' }),
}))
vi.mock('@/components/admin/settings/team/add-people-dialog', () => ({
  AddPeopleDialog: () => null,
}))
vi.mock('@/components/admin/settings/team/cloud-ownership-actions', () => ({
  CloudOwnershipActions: () => null,
}))
vi.mock('@/components/admin/settings/team/pending-invitations', () => ({
  getExpiryText: () => ({ text: '', className: '' }),
  formatInviteDate: () => '',
  InvitationActions: () => null,
  InviteLinkRow: () => null,
}))
// Rendered in the actions cell of every other member's row: a re-rendered row
// re-renders it.
vi.mock('@/components/admin/settings/team/member-actions', () => ({
  MemberActions: () => {
    rowRenders.current += 1
    return null
  },
}))

afterEach(() => {
  restoreRuntimeLocale()
  rowRenders.current = 0
})

const tab = (
  <MembersTab
    currentMember={{ id: 'principal_admin' as never, role: 'admin', userId: 'user_admin' as never }}
    canManageMembers
  />
)

describe('MembersTab hydration', () => {
  it('re-renders only the date labels when hydration ends', async () => {
    setRuntimeLocale('en-GB', 'America/Los_Angeles')
    const container = document.createElement('div')
    container.innerHTML = renderToString(tab)
    expect(container.textContent).toContain('1/5/2026')

    const serverRenders = rowRenders.current
    expect(serverRenders).toBeGreaterThan(0)

    rowRenders.current = 0
    setRuntimeLocale(VIEWER.locale, VIEWER.timeZone)
    const errors: unknown[] = []
    await act(async () => {
      hydrateRoot(container, tab, { onRecoverableError: (error) => errors.push(error) })
    })

    expect(errors).toEqual([])
    // The label switched to the viewer's format...
    expect(container.textContent).toContain(formatIn(VIEWER.locale, VIEWER.timeZone, OLD_SIGN_IN))
    // ...and each row rendered once, in the hydrating pass, as it did on the server.
    expect(rowRenders.current).toBe(serverRenders)
  })
})
