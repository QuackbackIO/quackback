// @vitest-environment happy-dom
/**
 * UserDetail — the reworked admin profile (identity header, facts strip,
 * activity/conversations tabs, CRM rail).
 *
 * Covers layout contracts that the mockups pin:
 *   - facts strip shows em dashes for missing last-seen / country
 *   - destructive actions live in the overflow menu, not stacked buttons
 *   - View public profile is present
 *   - External ID is surfaced in Account and stripped from Attributes
 *   - a lead with no email still renders Send message (disabled)
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PortalUserDetail } from '@/lib/shared/types'
import type { PrincipalId } from '@quackback/ids'

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({
    settings: { featureFlags: { supportInbox: true } },
  }),
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
  engagedPosts: [],
}

function renderDetail(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('UserDetail', () => {
  it('renders the facts strip, public-profile link, and overflow actions', async () => {
    renderDetail(
      <UserDetail
        user={BASE_USER}
        isLoading={false}
        onClose={vi.fn()}
        onRemoveUser={vi.fn()}
        isRemovePending={false}
        currentMemberRole="admin"
      />
    )

    expect(screen.getByText('Maya Chen')).toBeInTheDocument()
    expect(screen.getByText('View public profile')).toBeInTheDocument()
    expect(screen.getByText('Germany')).toBeInTheDocument()
    expect(screen.getByText('Posts')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Activity')).toBeInTheDocument()
    expect(screen.getByText('No activity yet')).toBeInTheDocument()
    expect(screen.getByText('Company')).toBeInTheDocument()
    expect(screen.getByText('No company')).toBeInTheDocument()
    expect(screen.getByText('usr_7f3a91')).toBeInTheDocument()
    expect(screen.getByText('plan_tier')).toBeInTheDocument()
    expect(screen.queryByText('_externalUserId')).not.toBeInTheDocument()

    // Destructive actions are in the overflow menu, not stacked buttons.
    expect(screen.queryByRole('button', { name: 'Remove from portal' })).not.toBeInTheDocument()
    fireEvent.pointerDown(screen.getByLabelText('More actions'), { button: 0, ctrlKey: false })
    expect(await screen.findByRole('menuitem', { name: 'Block' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Remove from portal' })).toBeInTheDocument()
  })

  it('renders em dashes for missing last-seen and country', () => {
    renderDetail(
      <UserDetail
        user={{ ...BASE_USER, lastSeenAt: null, country: null }}
        isLoading={false}
        onClose={vi.fn()}
        onRemoveUser={vi.fn()}
        isRemovePending={false}
        currentMemberRole="admin"
      />
    )
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps Send message visible but disabled for a lead with no email', async () => {
    renderDetail(
      <UserDetail
        user={{
          ...BASE_USER,
          name: null,
          email: null,
          emailVerified: false,
          isLead: true,
          metadata: null,
        }}
        isLoading={false}
        onClose={vi.fn()}
        onRemoveUser={vi.fn()}
        isRemovePending={false}
        currentMemberRole="admin"
      />
    )
    expect(screen.getByText('Unnamed user')).toBeInTheDocument()
    expect(screen.getByText('Lead')).toBeInTheDocument()
    expect(screen.getByText(/No email/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Send message/ })).toBeDisabled()
    fireEvent.pointerDown(screen.getByLabelText('More actions'), { button: 0, ctrlKey: false })
    expect(await screen.findByRole('menuitem', { name: 'Merge' })).toBeInTheDocument()
  })
})
