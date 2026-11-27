// @vitest-environment happy-dom
/**
 * Profile controls follow the granular permissions the server functions
 * behind them check (owner decision D8), not the legacy admin column:
 *
 *   - edit, block, merge, remove, tags and the changelog switch: people.manage
 *   - the Company card: company.manage
 *   - the Segments card: segment.manage
 *   - Make teammate and Change role: member.manage, and only an admin may
 *     grant Admin or change an admin (the server's grant ceiling)
 *
 * The permissions come from the `/admin` route context, as in the app: the
 * built-in presets resolve from the legacy role, a custom role from its keys.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PortalUserDetail } from '@/lib/shared/types'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

const route = vi.hoisted(() => ({
  role: 'admin' as string,
  permissions: undefined as string[] | undefined,
}))

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: (opts?: { select?: (context: never) => unknown }) => {
    const context = {
      settings: { featureFlags: {} },
      session: null,
      principal: { role: route.role },
      ...(route.permissions ? { permissions: route.permissions } : {}),
    }
    return opts?.select ? opts.select(context as never) : context
  },
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/server/functions/conversation', () => ({
  listConversationsForUserFn: vi.fn(),
  getConversationFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/blocking', () => ({
  getPersonBlockStatusFn: vi.fn().mockResolvedValue({ blockedAt: null }),
  blockPersonFn: vi.fn(),
  unblockPersonFn: vi.fn(),
}))
vi.mock('@/lib/client/mutations', () => ({
  useUpdatePortalUser: () => ({ mutate: vi.fn(), isPending: false }),
  useMergeLeadIntoUser: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/components/admin/conversation/new-conversation-dialog', () => ({
  NewConversationDialog: () => null,
}))

// The rail cards and the duplicates banner report the gate they were given.
const rail = vi.hoisted(() => ({}) as Record<string, boolean | undefined>)
vi.mock('../user-company-control', () => ({
  UserCompanyControl: (p: { canManage: boolean }) => ((rail.company = p.canManage), null),
}))
vi.mock('../user-segments', () => ({
  UserSegmentBadges: (p: { canManage: boolean }) => ((rail.segments = p.canManage), null),
}))
vi.mock('../user-tag-control', () => ({
  UserTagControl: (p: { canManage: boolean }) => ((rail.tags = p.canManage), null),
}))
vi.mock('../duplicate-users-warning', () => ({
  DuplicateUsersWarning: (p: { canManage: boolean }) => ((rail.duplicates = p.canManage), null),
}))
vi.mock('../changelog-subscription-control', () => ({
  ChangelogSubscriptionControl: () => ((rail.changelog = true), null),
}))

type DialogProps = Record<string, unknown> & { open?: boolean }
const dialogs = vi.hoisted(() => ({
  add: null as null | DialogProps,
  change: null as null | DialogProps,
}))
vi.mock('@/components/admin/settings/team/add-people-dialog', () => ({
  AddPeopleDialog: (props: DialogProps) => ((dialogs.add = props), null),
}))
vi.mock('@/components/admin/settings/team/change-role-dialog', () => ({
  ChangeRoleDialog: (props: DialogProps) => ((dialogs.change = props), null),
}))

import { UserDetail } from '../user-detail'

const PORTAL_USER: PortalUserDetail = {
  principalId: 'principal_1' as PrincipalId,
  userId: 'user_1',
  name: 'Maya Chen',
  email: 'maya@northwind.example',
  image: null,
  emailVerified: true,
  joinedAt: new Date('2025-03-12T00:00:00.000Z'),
  createdAt: new Date('2025-03-12T00:00:00.000Z'),
  postCount: 1,
  commentCount: 1,
  voteCount: 1,
  segments: [],
  metadata: null,
  isLead: false,
  contactEmail: null,
  lastSeenAt: null,
  country: null,
  language: { chosen: null, detected: null },
  teamRole: null,
  hasSignedIn: true,
  engagedPosts: [],
}

beforeEach(() => {
  for (const key of Object.keys(rail)) delete rail[key]
  dialogs.add = null
  dialogs.change = null
})
afterEach(cleanup)

function renderAs(
  viewer: { role: string; permissions?: PermissionKey[] },
  user: PortalUserDetail = PORTAL_USER
) {
  route.role = viewer.role
  route.permissions = viewer.permissions
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UserDetail
        user={user}
        isLoading={false}
        onClose={vi.fn()}
        onRemoveUser={vi.fn()}
        isRemovePending={false}
        currentMemberRole={viewer.role}
      />
    </QueryClientProvider>
  )
}

async function menuItems(): Promise<string[]> {
  const trigger = screen.queryByLabelText('More actions')
  if (!trigger) return []
  fireEvent.click(trigger)
  return (await screen.findAllByRole('menuitem')).map((item) => item.textContent?.trim() ?? '')
}

const hasEditPencil = () => screen.queryByTitle('Edit user details') !== null

describe('profile controls by permission', () => {
  it('the built-in Manager (people, company and segment manage) manages the person', async () => {
    renderAs({ role: 'member' })
    expect(hasEditPencil()).toBe(true)
    expect(rail).toMatchObject({
      company: true,
      segments: true,
      tags: true,
      duplicates: true,
      changelog: true,
    })
    const items = await menuItems()
    expect(items).toEqual(expect.arrayContaining(['Block', 'Remove from portal']))
    // Manager holds no member.manage.
    expect(items).not.toContain('Make teammate…')
  })

  it('people.manage alone edits the person but not their company or segments', async () => {
    renderAs({ role: 'member', permissions: [PERMISSIONS.PEOPLE_VIEW, PERMISSIONS.PEOPLE_MANAGE] })
    expect(hasEditPencil()).toBe(true)
    expect(rail).toMatchObject({ company: false, segments: false, tags: true, changelog: true })
    expect(await menuItems()).toEqual(expect.arrayContaining(['Block', 'Remove from portal']))
  })

  it('company.manage and segment.manage alone open only their own cards', async () => {
    renderAs({
      role: 'member',
      permissions: [
        PERMISSIONS.PEOPLE_VIEW,
        PERMISSIONS.COMPANY_MANAGE,
        PERMISSIONS.SEGMENT_MANAGE,
      ],
    })
    expect(hasEditPencil()).toBe(false)
    expect(rail).toMatchObject({ company: true, segments: true, tags: false, duplicates: false })
    expect(rail.changelog).toBeUndefined()
    expect(await menuItems()).toEqual([])
  })

  it('a legacy admin whose custom role lacks the keys gets no controls', async () => {
    renderAs({ role: 'admin', permissions: [PERMISSIONS.PEOPLE_VIEW] })
    expect(hasEditPencil()).toBe(false)
    expect(rail).toMatchObject({ company: false, segments: false, tags: false })
    expect(await menuItems()).toEqual([])
  })

  it('member.manage without the admin tier makes a teammate, never an Admin', async () => {
    renderAs({ role: 'member', permissions: [PERMISSIONS.PEOPLE_VIEW, PERMISSIONS.MEMBER_MANAGE] })
    const items = await menuItems()
    expect(items).toContain('Make teammate…')
    expect(items).not.toContain('Block')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make teammate…' }))
    await vi.waitFor(() => expect(dialogs.add).not.toBeNull())
    expect(dialogs.add?.canGrantAdmin).toBe(false)
  })

  it('member.manage without the admin tier offers no Change role on an admin', async () => {
    renderAs(
      { role: 'member', permissions: [PERMISSIONS.PEOPLE_VIEW, PERMISSIONS.MEMBER_MANAGE] },
      { ...PORTAL_USER, teamRole: { role: 'admin' } }
    )
    expect(await menuItems()).toEqual([])
  })

  it('member.manage without the admin tier changes a member role, never to Admin', async () => {
    renderAs(
      { role: 'member', permissions: [PERMISSIONS.PEOPLE_VIEW, PERMISSIONS.MEMBER_MANAGE] },
      { ...PORTAL_USER, teamRole: { role: 'member' } }
    )
    fireEvent.click(screen.getByLabelText('More actions'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change role…' }))
    await vi.waitFor(() => expect(dialogs.change).not.toBeNull())
    expect(dialogs.change?.canGrantAdmin).toBe(false)
  })

  it('the Owner keeps every control and may grant Admin', async () => {
    renderAs({ role: 'admin' })
    expect(hasEditPencil()).toBe(true)
    expect(rail).toMatchObject({ company: true, segments: true, tags: true, changelog: true })
    expect(await menuItems()).toEqual(
      expect.arrayContaining(['Make teammate…', 'Block', 'Remove from portal'])
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make teammate…' }))
    await vi.waitFor(() => expect(dialogs.add).not.toBeNull())
    expect(dialogs.add?.canGrantAdmin).toBe(true)
  })
})
