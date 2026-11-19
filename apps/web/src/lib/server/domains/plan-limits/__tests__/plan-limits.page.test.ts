import { describe, expect, it } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import { DISABLED_CLOUD_CONFIG } from '@/lib/server/domains/settings/cloud/cloud.types'
import { planFeatureSet } from '../plan-limits.features'
import { planLimitsPage } from '../plan-limits.page'
import type { PlanLimitsView } from '../plan-limits.rules'

const features = planFeatureSet(OSS_TIER_LIMITS.features, DISABLED_CLOUD_CONFIG)

const view: PlanLimitsView = {
  enabled: true,
  phase: 'grace',
  plan: 'free',
  since: '2026-11-18T00:00:00.000Z',
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
      cap: 1,
      message: 'You have 3 out of 1 seats',
      actionLabel: 'Remove 2 seats',
      href: '/admin/settings/members',
    },
  ],
  infoRows: [],
  featureIssues: [{ key: 'webhooks', count: 2 }],
  features,
  fromFeatures: features,
  openBoardIds: ['b1'],
  keptBoardId: 'b1',
  seatHolderIds: ['p1'],
  visibleStatusComponentIds: null,
  sendingDomainIds: null,
}

const candidates = {
  boards: [
    { id: 'b1', name: 'Acme', slug: 'acme', postCount: 1, createdAt: '', lastActivityAt: null },
  ],
  members: [
    {
      id: 'p1',
      name: 'Acme',
      email: 'owner@example.com',
      roleNames: [],
      isOwner: true,
      canManageBilling: true,
      isAdmin: true,
      lastActiveAt: null,
      createdAt: '',
    },
  ],
}

describe('planLimitsPage', () => {
  it('gives a billing manager every chooser for a cap that is over', () => {
    const page = planLimitsPage(view, candidates, [PERMISSIONS.BILLING_MANAGE])
    expect(page.choosers).toEqual({
      board: true,
      seats: true,
      statusComponents: false,
      sendingDomains: false,
    })
    expect(page.candidates.boards).toHaveLength(1)
    expect(page.candidates.members).toHaveLength(1)
    expect(page.canManageBilling).toBe(true)
    expect(page.planName).toBe('Free')
    expect(page.graceEndsAt).toBe('2026-11-25T12:00:00.000Z')
    expect(page.deadlineDay).toBe('2026-11-24')
    expect(page.fromPlanName).toBe('Pro')
  })

  it('shows a teammate only the choosers their permissions allow, and no member list otherwise', () => {
    const page = planLimitsPage(view, candidates, [PERMISSIONS.SETTINGS_MANAGE])
    expect(page.choosers.board).toBe(true)
    expect(page.choosers.seats).toBe(false)
    expect(page.candidates.members).toBeUndefined()
    expect(page.canManageBilling).toBe(false)
  })

  it('names each paused feature and links to where it is set up', () => {
    const page = planLimitsPage(view, candidates, [])
    expect(page.featureIssues).toEqual([
      { key: 'webhooks', count: 2, label: 'Webhooks', href: '/admin/settings/developers' },
    ])
    expect(page).not.toHaveProperty('fromFeatures')
  })

  it('links the custom domain to the Custom domains tab of Settings > Portal, and custom CSS to Settings > Portal', () => {
    const page = planLimitsPage(
      {
        ...view,
        featureIssues: [
          { key: 'customDomain', count: 1 },
          { key: 'customCss', count: 1 },
        ],
      },
      candidates,
      []
    )
    expect(page.featureIssues.map((issue) => issue.href)).toEqual([
      '/admin/settings/portal?tab=custom-domains',
      '/admin/settings/portal',
    ])
  })
})
