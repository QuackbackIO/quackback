/**
 * The banner's read for a teammate who cannot view members: enough to say
 * the workspace is over and by when, and nothing about the team.
 */
import { describe, expect, it } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import { DISABLED_CLOUD_CONFIG } from '@/lib/server/domains/settings/cloud/cloud.types'
import { planFeatureSet } from '../plan-limits.features'
import { planLimitsNotice } from '../plan-limits.notice'
import type { PlanLimitsView } from '../plan-limits.rules'

const features = planFeatureSet(OSS_TIER_LIMITS.features, DISABLED_CLOUD_CONFIG)

// Distinctive numbers and ids, so a leak of any of them shows in the JSON.
const view: PlanLimitsView = {
  enabled: true,
  phase: 'enforced',
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
      used: 4637,
      cap: 4629,
      message: 'You have 4637 out of 4629 seats',
      actionLabel: 'Remove 8 seats',
      href: '/admin/settings/members',
    },
  ],
  fixedIssues: [{ key: 'maxTeamSeats', used: 4611, cap: 4612 }],
  infoRows: [{ key: 'maxPosts', used: 77, cap: 50, message: 'You have 77 out of 50 posts' }],
  featureIssues: [{ key: 'webhooks', count: 2 }],
  features,
  fromFeatures: features,
  openBoardIds: ['board_secret'],
  keptBoardId: 'board_secret',
  seatHolderIds: ['principal_secret_owner', 'principal_secret_recent'],
  visibleStatusComponentIds: ['component_secret'],
  sendingDomainIds: ['domain_secret'],
}

describe('planLimitsNotice', () => {
  it('says what is over and by when', () => {
    const notice = planLimitsNotice(view, [PERMISSIONS.BILLING_MANAGE])
    expect(notice).toEqual({
      canViewPage: false,
      enabled: true,
      phase: 'enforced',
      graceEndsAt: '2026-11-25T12:00:00.000Z',
      deadlineDay: '2026-11-24',
      planName: 'Free',
      fromPlanName: 'Pro',
      canManageBilling: true,
      issues: [{ key: 'maxBoards', used: 3, cap: 1 }],
      withheldIssues: ['maxTeamSeats'],
      featureIssues: [expect.objectContaining({ key: 'webhooks', count: 2 })],
    })
  })

  it('carries no member ids, seat counts or links to the team', () => {
    const json = JSON.stringify(planLimitsNotice(view, []))
    for (const secret of ['4637', '4629', '4611', '4612', 'principal_secret', '/members']) {
      expect(json).not.toContain(secret)
    }
    // Nor the ids of anything the choosers pick, which the banner never needs.
    expect(json).not.toContain('_secret')
    expect(json).not.toMatch(/candidates|seatHolder|lockedSeat|choosers/)
  })

  it('knows when the viewer cannot manage billing', () => {
    expect(planLimitsNotice(view, [PERMISSIONS.POST_VIEW_PRIVATE]).canManageBilling).toBe(false)
  })

  it('withholds nothing when seats fit', () => {
    const notice = planLimitsNotice({ ...view, issues: view.issues.slice(0, 1) }, [])
    expect(notice.withheldIssues).toEqual([])
  })
})
