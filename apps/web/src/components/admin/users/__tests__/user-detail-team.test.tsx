// @vitest-environment happy-dom
/**
 * UserDetail team actions: a signed-in portal user can be made a teammate
 * from the "..." menu, through the shared Add people dialog prefilled with
 * them. Once they are on the team the badge shows their role and the menu
 * offers Change role instead.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PortalUserDetail } from '@/lib/shared/types'
import type { PrincipalId } from '@quackback/ids'

const route = vi.hoisted(() => ({ sessionUserId: null as string | null }))

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: (opts?: { select?: (context: never) => unknown }) => {
    const context = {
      settings: { featureFlags: { supportInbox: true } },
      session: route.sessionUserId ? { user: { id: route.sessionUserId } } : null,
    }
    return opts?.select ? opts.select(context as never) : context
  },
  Link: ({
    children,
    to,
    ...props
  }: {
    children: ReactNode
    to: string
    [key: string]: unknown
  }) => (
    <a href={typeof to === 'string' ? to : '#'} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/server/functions/conversation', () => ({
  listConversationsForUserFn: vi.fn().mockResolvedValue({
    conversations: [],
    hasMore: false,
    nextCursor: null,
  }),
  getConversationFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/blocking', () => ({
  getPersonBlockStatusFn: vi.fn().mockResolvedValue({ blockedAt: null }),
  blockPersonFn: vi.fn(),
  unblockPersonFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/changelog-subscriptions', () => ({
  getChangelogSubscriptionStatusFn: vi.fn().mockResolvedValue({ subscribed: true }),
  setChangelogSubscriptionFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/companies', () => ({
  getCompanyForPrincipalFn: vi.fn().mockResolvedValue(null),
  listCompaniesFn: vi.fn().mockResolvedValue([]),
  createCompanyFn: vi.fn(),
  attachPrincipalToCompanyFn: vi.fn(),
  detachPrincipalFromCompanyFn: vi.fn(),
}))

vi.mock('@/lib/client/hooks/use-user-tags', () => ({
  useUserTags: () => ({ data: [] }),
  useUserTagsForPrincipal: () => ({ data: [] }),
  useAssignUserTag: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveUserTag: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/lib/client/hooks/use-segments-queries', () => ({
  useSegments: () => ({ data: [] }),
}))

vi.mock('@/lib/client/mutations', () => ({
  useUpdatePortalUser: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveUsersFromSegment: () => ({ mutateAsync: vi.fn() }),
  useAssignUsersToSegment: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useMergeLeadIntoUser: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('../duplicate-users-warning', () => ({
  DuplicateUsersWarning: () => null,
}))

vi.mock('@/components/admin/conversation/new-conversation-dialog', () => ({
  NewConversationDialog: () => null,
}))

type DialogProps = Record<string, unknown> & { open?: boolean }
const dialogs = vi.hoisted(() => ({
  add: null as null | DialogProps,
  change: null as null | DialogProps,
}))

vi.mock('@/components/admin/settings/team/add-people-dialog', () => ({
  AddPeopleDialog: (props: DialogProps) => {
    dialogs.add = props
    return props.open ? <div role="dialog" aria-label="add people" /> : null
  },
}))

vi.mock('@/components/admin/settings/team/change-role-dialog', () => ({
  ChangeRoleDialog: (props: DialogProps) => {
    dialogs.change = props
    return props.open ? <div role="dialog" aria-label="change role" /> : null
  },
}))

import { UserDetail } from '../user-detail'

const BASE_USER: PortalUserDetail = {
  principalId: 'principal_1' as PrincipalId,
  userId: 'user_1',
  name: 'Maya Chen',
  email: 'maya@northwind.example',
  image: null,
  emailVerified: true,
  joinedAt: new Date('2025-03-12T00:00:00.000Z'),
  createdAt: new Date('2025-03-12T00:00:00.000Z'),
  postCount: 12,
  commentCount: 34,
  voteCount: 87,
  segments: [],
  metadata: JSON.stringify({ plan_tier: 'growth', _externalUserId: 'usr_7f3a91' }),
  isLead: false,
  contactEmail: null,
  lastSeenAt: new Date('2026-04-01T12:00:00.000Z'),
  country: 'DE',
  teamRole: null,
  hasSignedIn: true,
  engagedPosts: [],
}

function renderDetail(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
  return {
    rerender: (next: ReactElement) =>
      view.rerender(<QueryClientProvider client={queryClient}>{next}</QueryClientProvider>),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  dialogs.add = null
  dialogs.change = null
  route.sessionUserId = null
})
afterEach(cleanup)

function detail(user: PortalUserDetail, role = 'admin') {
  return (
    <UserDetail
      user={user}
      isLoading={false}
      onClose={vi.fn()}
      onRemoveUser={vi.fn()}
      isRemovePending={false}
      currentMemberRole={role}
    />
  )
}

async function openMenu() {
  fireEvent.click(screen.getByLabelText('More actions'))
  await screen.findAllByRole('menuitem')
}

describe('UserDetail team actions', () => {
  it('makes a signed-in portal user a teammate through the prefilled dialog', async () => {
    renderDetail(detail(BASE_USER))
    expect(screen.getByText('User')).toBeInTheDocument()

    await openMenu()
    expect(screen.queryByRole('menuitem', { name: 'Change role…' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make teammate…' }))

    expect(await screen.findByRole('dialog', { name: 'add people' })).toBeInTheDocument()
    expect(dialogs.add?.initialPerson).toEqual({
      principalId: 'principal_1',
      name: 'Maya Chen',
      avatarUrl: null,
      detail: 'maya@northwind.example',
    })
    expect(dialogs.add?.canGrantAdmin).toBe(true)
  })

  it('shows the role once the reloaded detail says they joined, and offers Change role', async () => {
    const view = renderDetail(detail(BASE_USER))
    view.rerender(detail({ ...BASE_USER, teamRole: { role: 'member' } }))
    expect(screen.getByText('Member')).toBeInTheDocument()
    expect(screen.queryByText('User')).toBeNull()

    await openMenu()
    expect(screen.queryByRole('menuitem', { name: 'Make teammate…' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change role…' }))
    expect(await screen.findByRole('dialog', { name: 'change role' })).toBeInTheDocument()
    expect(dialogs.change?.principalId).toBe('principal_1')
    expect(dialogs.change?.current).toEqual({ role: 'member', label: 'Member' })
  })

  it('offers a teammate no portal-only actions', async () => {
    renderDetail(detail({ ...BASE_USER, teamRole: { role: 'member' } }))
    await openMenu()
    expect(screen.getByRole('menuitem', { name: 'Change role…' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Block' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Remove from portal' })).toBeNull()
  })

  it('keeps Block and Remove from portal for a portal user', async () => {
    renderDetail(detail(BASE_USER))
    await openMenu()
    expect(screen.getByRole('menuitem', { name: 'Block' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Remove from portal' })).toBeInTheDocument()
  })

  it('offers no Change role on your own profile', () => {
    route.sessionUserId = 'user_1'
    renderDetail(detail({ ...BASE_USER, teamRole: { role: 'admin' } }))
    // Nothing else applies to your own teammate profile, so there is no menu.
    expect(screen.queryByLabelText('More actions')).toBeNull()
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('shows a custom role by name', () => {
    renderDetail(
      detail({
        ...BASE_USER,
        teamRole: { role: 'member', roleId: 'role_editor', roleName: 'Editor' },
      })
    )
    expect(screen.getByText('Editor')).toBeInTheDocument()
  })

  it('does not offer someone who has never signed in', async () => {
    renderDetail(detail({ ...BASE_USER, hasSignedIn: false }))
    await openMenu()
    expect(screen.queryByRole('menuitem', { name: 'Make teammate…' })).toBeNull()
  })

  it('does not offer a lead to the team', async () => {
    renderDetail(detail({ ...BASE_USER, isLead: true, email: null }))
    await openMenu()
    expect(screen.queryByRole('menuitem', { name: 'Make teammate…' })).toBeNull()
    expect(dialogs.add).toBeNull()
  })

  it('offers nothing to someone who cannot manage people', () => {
    renderDetail(detail(BASE_USER, 'member'))
    expect(screen.queryByLabelText('More actions')).toBeNull()
  })
})
