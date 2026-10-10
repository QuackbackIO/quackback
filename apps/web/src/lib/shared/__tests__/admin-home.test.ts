import { describe, expect, it } from 'vitest'
import { PRODUCT_DEFINITIONS } from '@/lib/shared/types/settings'
import { homeActionGroups, homeModuleTitle, resolveAdminHomePath } from '../admin-home'

describe('resolveAdminHomePath', () => {
  it('sends every admin to Overview', () => {
    expect(
      resolveAdminHomePath({ isAdmin: true, launchResolved: false, flags: { feedback: true } })
    ).toBe('/admin')
    expect(
      resolveAdminHomePath({ isAdmin: true, launchResolved: true, flags: { feedback: true } })
    ).toBe('/admin')
  })

  it('sends members to Overview too', () => {
    expect(
      resolveAdminHomePath({ isAdmin: false, launchResolved: false, flags: { feedback: true } })
    ).toBe('/admin')
  })
})

describe('homeModuleTitle', () => {
  it('matches Settings → Modules labels', () => {
    expect(PRODUCT_DEFINITIONS.map((product) => homeModuleTitle(product.id))).toEqual(
      PRODUCT_DEFINITIONS.map((product) => product.label)
    )
  })
})

describe('homeActionGroups', () => {
  it('lists only Feedback and Changelog actions on the default core flags', () => {
    expect(homeActionGroups({ feedback: true, changelog: true })).toEqual([
      {
        productId: 'feedback',
        label: 'Feedback & Roadmaps',
        actions: [{ id: 'new-post', label: 'New post', productId: 'feedback' }],
      },
      {
        productId: 'changelog',
        label: 'Changelog',
        actions: [{ id: 'new-changelog', label: 'New changelog', productId: 'changelog' }],
      },
    ])
  })

  it('adds Support, Help Center, and Status actions when those modules are on', () => {
    const groups = homeActionGroups({
      feedback: true,
      changelog: true,
      supportInbox: true,
      supportTickets: true,
      helpCenter: true,
      statusPage: true,
    })
    expect(groups.map((group) => group.label)).toEqual([
      'Feedback & Roadmaps',
      'Support',
      'Help Center',
      'Changelog',
      'Status',
    ])
    expect(
      groups.find((group) => group.productId === 'support')?.actions.map((action) => action.id)
    ).toEqual(['new-conversation', 'new-ticket'])
  })

  it('omits conversation when only tickets are on', () => {
    const support = homeActionGroups({ supportTickets: true }).find(
      (group) => group.productId === 'support'
    )
    expect(support?.actions.map((action) => action.id)).toEqual(['new-ticket'])
  })
})
