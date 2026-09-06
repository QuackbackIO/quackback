import { describe, expect, it } from 'vitest'
import {
  featuresDisabledOnDowngrade,
  featuresDisabledOnFree,
  freeDowngradeIssues,
  planDowngradeIssues,
} from '../plan-downgrade'

describe('freeDowngradeIssues', () => {
  it('is empty when usage fits Free', () => {
    expect(
      freeDowngradeIssues({
        maxBoards: 1,
        maxPosts: 10,
        maxTeamSeats: 1,
        maxStatusComponents: 1,
        maxCustomRoles: 0,
        maxSendingDomains: 0,
      })
    ).toEqual([])
  })

  it('asks to remove extra boards against the Free cap of 1', () => {
    const issues = freeDowngradeIssues({ maxBoards: 5 })
    expect(issues).toEqual([
      {
        key: 'maxBoards',
        used: 5,
        cap: 1,
        message: 'You have 5 out of 1 boards',
        actionLabel: 'Remove 4 boards',
        href: '/admin/settings/boards',
      },
    ])
  })

  it('pluralizes seats to remove', () => {
    const issues = freeDowngradeIssues({ maxTeamSeats: 4 })
    expect(issues[0]).toMatchObject({
      used: 4,
      cap: 1,
      message: 'You have 4 out of 1 seats',
      actionLabel: 'Remove 3 seats',
    })
  })
})

describe('planDowngradeIssues', () => {
  it('skips unlimited caps on a paid plan', () => {
    expect(planDowngradeIssues({ maxBoards: 12, maxPosts: 400 }, 'pro')).toEqual([])
  })

  it('flags status components over the Pro (growth) cap', () => {
    const issues = planDowngradeIssues({ maxStatusComponents: 12, maxSendingDomains: 1 }, 'pro')
    expect(issues).toEqual([
      {
        key: 'maxStatusComponents',
        used: 12,
        cap: 10,
        message: 'You have 12 out of 10 status components',
        actionLabel: 'Remove 2 status components',
        href: '/admin/settings/status',
      },
    ])
  })

  it('requires deleting every custom role when the target cap is 0', () => {
    const issues = planDowngradeIssues({ maxCustomRoles: 2 }, 'pro')
    expect(issues[0]).toMatchObject({
      message: 'You have 2 out of 0 custom roles',
      actionLabel: 'Remove 2 custom roles',
    })
  })

  it('treats business as the Business (pro) caps', () => {
    expect(planDowngradeIssues({ maxStatusComponents: 25 }, 'business')).toEqual([])
    expect(planDowngradeIssues({ maxStatusComponents: 26 }, 'business')[0]?.cap).toBe(25)
  })
})

describe('featuresDisabledOnFree', () => {
  it('names Pro features when the trial plan is Pro', () => {
    expect(featuresDisabledOnFree('pro')).toContain('MCP access will be revoked')
    expect(featuresDisabledOnFree('pro')).not.toContain(
      'Workflows and automations will be disabled'
    )
  })

  it('names Business features when leaving Business', () => {
    expect(featuresDisabledOnFree('business')).toContain(
      'Workflows and automations will be disabled'
    )
  })

  it('only lists disabled features when the target is Free', () => {
    expect(featuresDisabledOnDowngrade('scale', 'pro')).toEqual([])
    expect(featuresDisabledOnDowngrade('scale', 'free').length).toBeGreaterThan(0)
  })
})
