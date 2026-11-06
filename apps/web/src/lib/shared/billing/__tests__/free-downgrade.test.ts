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

  it('flags inbound email addresses over the Free cap of 1', () => {
    const issues = planDowngradeIssues({ maxInboundEmailAddresses: 2 }, 'free')
    expect(issues).toEqual([
      {
        key: 'maxInboundEmailAddresses',
        used: 2,
        cap: 1,
        message: 'You have 2 out of 1 inbound email addresses',
        actionLabel: 'Remove 1 inbound email address',
        href: '/admin/settings/channels/email',
      },
    ])
  })

  it('flags help center languages over the Business cap of 3', () => {
    const issues = planDowngradeIssues({ maxHelpCenterLocales: 5 }, 'business')
    expect(issues).toEqual([
      {
        key: 'maxHelpCenterLocales',
        used: 5,
        cap: 3,
        message: 'You have 5 out of 3 help center languages',
        actionLabel: 'Remove 2 help center languages',
        href: '/admin/settings/help-center?tab=domains-languages',
      },
    ])
  })

  it('flags status subscribers over the Free cap of 100', () => {
    const issues = planDowngradeIssues({ maxStatusSubscribers: 101 }, 'free')
    expect(issues).toEqual([
      {
        key: 'maxStatusSubscribers',
        used: 101,
        cap: 100,
        message: 'You have 101 out of 100 status subscribers',
        actionLabel: 'Remove 1 status subscriber',
        href: '/admin/status?view=subscribers',
      },
    ])
  })

  it('allows usage exactly at the inbound, locale and subscriber caps of each paid plan', () => {
    expect(
      planDowngradeIssues(
        { maxInboundEmailAddresses: 1, maxHelpCenterLocales: 1, maxStatusSubscribers: 250 },
        'pro'
      )
    ).toEqual([])
    expect(
      planDowngradeIssues(
        { maxInboundEmailAddresses: 2, maxHelpCenterLocales: 3, maxStatusSubscribers: 1000 },
        'business'
      )
    ).toEqual([])
  })

  it('never flags the inbound, locale and subscriber caps on Enterprise, where they are unlimited', () => {
    expect(
      planDowngradeIssues(
        { maxInboundEmailAddresses: 50, maxHelpCenterLocales: 40, maxStatusSubscribers: 100000 },
        'enterprise'
      )
    ).toEqual([])
  })

  it('blocks a downgrade to Free while more than one help center language is enabled', () => {
    const issues = freeDowngradeIssues({ maxHelpCenterLocales: 2 })
    expect(issues[0]).toMatchObject({
      key: 'maxHelpCenterLocales',
      cap: 1,
      message: 'You have 2 out of 1 help center languages',
      actionLabel: 'Remove 1 help center language',
    })
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

  it('never warns that API access is revoked, since every plan includes the REST API', () => {
    for (const plan of ['pro', 'business', 'enterprise']) {
      expect(featuresDisabledOnFree(plan)).not.toContain('API access will be revoked')
    }
    expect(featuresDisabledOnDowngrade('enterprise', 'pro')).not.toContain(
      'API access will be revoked'
    )
  })

  it('keeps Copilot drafts out of the Free warning, since Free includes them', () => {
    for (const plan of ['pro', 'business', 'enterprise']) {
      expect(featuresDisabledOnFree(plan).join(' ')).not.toMatch(/drafts/i)
      expect(featuresDisabledOnFree(plan)).toContain('AI assistant and insights will be disabled')
    }
  })

  it('warns that AI article translation stops when leaving Business or Enterprise', () => {
    expect(featuresDisabledOnFree('business')).toContain('AI article translation will be disabled')
    expect(featuresDisabledOnDowngrade('business', 'pro')).toContain(
      'AI article translation will be disabled'
    )
    expect(featuresDisabledOnDowngrade('enterprise', 'pro')).toContain(
      'AI article translation will be disabled'
    )
  })

  it('names what a paid-to-paid downgrade loses, and nothing for an upgrade or the same plan', () => {
    expect(featuresDisabledOnDowngrade('enterprise', 'business')).toEqual([
      'Single sign-on will be disabled',
      'The audit log will be disabled',
    ])
    expect(featuresDisabledOnDowngrade('business', 'pro')).toContain(
      'Workflows and automations will be disabled'
    )
    expect(featuresDisabledOnDowngrade('pro', 'business')).toEqual([])
    expect(featuresDisabledOnDowngrade('pro', 'pro')).toEqual([])
    expect(featuresDisabledOnDowngrade('scale', 'free').length).toBeGreaterThan(0)
  })
})

describe('seat cap on Business', () => {
  it('blocks a downgrade to Business with more than its 20 included seats', () => {
    expect(planDowngradeIssues({ maxTeamSeats: 21 }, 'business')).toEqual([
      expect.objectContaining({ key: 'maxTeamSeats', used: 21, cap: 20 }),
    ])
    expect(planDowngradeIssues({ maxTeamSeats: 20 }, 'business')).toEqual([])
  })
})
