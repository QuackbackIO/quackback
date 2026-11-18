import type { PlanLimitsPage } from '@/lib/server/domains/plan-limits/plan-limits.page'

/** A Free workspace over three caps during grace, as `getPlanLimitsFn` returns it. */
export function overLimits(over: Partial<PlanLimitsPage> = {}): PlanLimitsPage {
  return {
    enabled: true,
    phase: 'grace',
    plan: 'free',
    since: '2026-11-18T12:00:00.000Z',
    graceEndsAt: '2026-11-25T12:00:00.000Z',
    deadlineDay: '2026-11-24',
    fromPlan: 'pro',
    issues: [
      {
        key: 'maxBoards',
        used: 3,
        cap: 1,
        message: 'You have 3 out of 1 boards',
        actionLabel: 'Remove 2 boards',
        href: '/admin/settings/boards',
      },
      {
        key: 'maxTeamSeats',
        used: 3,
        cap: 2,
        message: 'You have 3 out of 2 seats',
        actionLabel: 'Remove 1 seat',
        href: '/admin/settings/members',
      },
      {
        key: 'maxStatusComponents',
        used: 4,
        cap: 3,
        message: 'You have 4 out of 3 status components',
        actionLabel: 'Remove 1 status component',
        href: '/admin/settings/status',
      },
      {
        key: 'maxCustomRoles',
        used: 1,
        cap: 0,
        message: 'You have 1 out of 0 custom roles',
        actionLabel: 'Remove 1 custom role',
        href: '/admin/settings/members',
      },
    ],
    fixedIssues: [{ key: 'maxSendingDomains', used: 0, cap: 0 }],
    infoRows: [{ key: 'maxPosts', used: 77, cap: 50, message: 'You have 77 out of 50 posts' }],
    featureIssues: [
      { key: 'webhooks', count: 1, label: 'Webhooks', href: '/admin/settings/developers' },
    ],
    openBoardIds: ['board_a'],
    keptBoardId: 'board_a',
    seatHolderIds: ['p_owner', 'p_recent'],
    visibleStatusComponentIds: ['c1', 'c2', 'c3'],
    sendingDomainIds: null,
    planName: 'Free',
    fromPlanName: 'Pro',
    choosers: { board: true, seats: true, statusComponents: true, sendingDomains: false },
    candidates: {
      boards: [
        {
          id: 'board_a',
          name: 'Feature requests',
          slug: 'feature-requests',
          postCount: 41,
          createdAt: '2026-01-01T00:00:00.000Z',
          lastActivityAt: null,
        },
        {
          id: 'board_b',
          name: 'Bugs',
          slug: 'bugs',
          postCount: 18,
          createdAt: '2026-02-01T00:00:00.000Z',
          lastActivityAt: null,
        },
        {
          id: 'board_c',
          name: 'Mobile',
          slug: 'mobile',
          postCount: 6,
          createdAt: '2026-03-01T00:00:00.000Z',
          lastActivityAt: null,
        },
      ],
      members: [
        member('p_owner', 'Ada Owner', true),
        member('p_recent', 'Bea Recent', false),
        member('p_quiet', 'Cy Quiet', false),
      ],
      statusComponents: [
        { id: 'c1', name: 'API', groupName: null, groupPosition: null, position: 0 },
        { id: 'c2', name: 'Portal', groupName: null, groupPosition: null, position: 1 },
        { id: 'c3', name: 'Widget', groupName: 'Apps', groupPosition: 0, position: 0 },
        { id: 'c4', name: 'Email', groupName: 'Apps', groupPosition: 0, position: 1 },
      ],
    },
    lockedSeatHolderIds: ['p_owner'],
    canManageBilling: true,
    ...over,
  }
}

function member(id: string, name: string, isOwner: boolean) {
  return {
    id,
    name,
    email: `${id}@example.com`,
    roleNames: [isOwner ? 'Owner' : 'Member'],
    isOwner,
    canManageBilling: isOwner,
    isAdmin: isOwner,
    lastActiveAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}
