import { describe, expect, it } from 'vitest'
import {
  capIssues,
  featuresDisabledOnDowngrade,
  featuresDisabledOnFree,
  freeDowngradeIssues,
  planDowngradeInfo,
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

describe('posts never block a downgrade', () => {
  it('leaves posts over the Free cap out of the issues a downgrade must resolve', () => {
    expect(freeDowngradeIssues({ maxPosts: 400 })).toEqual([])
    expect(planDowngradeIssues({ maxPosts: 400, maxBoards: 2 }, 'free').map((i) => i.key)).toEqual([
      'maxBoards',
    ])
  })

  it('still shows posts over the cap as information', () => {
    expect(planDowngradeInfo({ maxPosts: 400 }, 'free')).toEqual([
      { key: 'maxPosts', used: 400, cap: 50, message: 'You have 400 out of 50 posts' },
    ])
    expect(planDowngradeInfo({ maxPosts: 50 }, 'free')).toEqual([])
    expect(planDowngradeInfo({ maxPosts: 400 }, 'pro')).toEqual([])
  })
})

describe('capIssues', () => {
  it('checks usage against the caps it is given, not a catalogue plan', () => {
    const issues = capIssues(
      { maxBoards: 3, maxTeamSeats: 9 },
      { maxBoards: 2, maxTeamSeats: null }
    )
    expect(issues).toEqual([
      {
        key: 'maxBoards',
        used: 3,
        cap: 2,
        message: 'You have 3 out of 2 boards',
        actionLabel: 'Remove 1 board',
        href: '/admin/settings/boards',
      },
    ])
  })

  it('only checks the keys it is asked about', () => {
    expect(
      capIssues({ maxBoards: 3, maxPosts: 90 }, { maxBoards: 1, maxPosts: 50 }, ['maxPosts'])
    ).toHaveLength(1)
  })
})

describe('featuresDisabledOnFree', () => {
  it('names Pro features when the trial plan is Pro', () => {
    expect(featuresDisabledOnFree('pro')).toContain('MCP access pauses.')
    expect(featuresDisabledOnFree('pro')).not.toContain('Live workflows pause after 7 days.')
  })

  it('names Business features when leaving Business', () => {
    expect(featuresDisabledOnFree('business')).toContain('Live workflows pause after 7 days.')
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
      expect(featuresDisabledOnFree(plan)).toContain(
        'The AI assistant pauses after 7 days. AI insights pause now.'
      )
    }
  })

  it('warns that AI article translation stops when leaving Business or Enterprise', () => {
    expect(featuresDisabledOnFree('business')).toContain(
      'AI article translation pauses after 7 days. Published translations stay.'
    )
    expect(featuresDisabledOnDowngrade('business', 'pro')).toContain(
      'AI article translation pauses after 7 days. Published translations stay.'
    )
    expect(featuresDisabledOnDowngrade('enterprise', 'pro')).toContain(
      'AI article translation pauses after 7 days. Published translations stay.'
    )
  })

  it('names what a paid-to-paid downgrade loses, and nothing for an upgrade or the same plan', () => {
    expect(featuresDisabledOnDowngrade('enterprise', 'business')).toEqual([
      'Single sign-on pauses after 7 days. Your team signs in with email links.',
      'The audit log is hidden. New entries are still recorded.',
    ])
    expect(featuresDisabledOnDowngrade('business', 'pro')).toContain(
      'Live workflows pause after 7 days.'
    )
    expect(featuresDisabledOnDowngrade('pro', 'business')).toEqual([])
    expect(featuresDisabledOnDowngrade('pro', 'pro')).toEqual([])
    expect(featuresDisabledOnDowngrade('scale', 'free').length).toBeGreaterThan(0)
  })
})

describe('downgrade feature copy', () => {
  it('says what pauses after 7 days, never that it is disabled or revoked', () => {
    const lines = featuresDisabledOnFree('enterprise')
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line).not.toMatch(/disabled|revoked|deleted|\u2014/i)
    }
    expect(lines).toContain('Webhooks pause after 7 days.')
    expect(lines).toContain(
      'Your custom domain pauses after 7 days. Links go to your workspace address.'
    )
    expect(featuresDisabledOnDowngrade('enterprise', 'business')).toEqual([
      'Single sign-on pauses after 7 days. Your team signs in with email links.',
      'The audit log is hidden. New entries are still recorded.',
    ])
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
