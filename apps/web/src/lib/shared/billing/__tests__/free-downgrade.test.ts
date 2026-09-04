import { describe, expect, it } from 'vitest'
import { featuresDisabledOnFree, freeDowngradeIssues } from '../free-downgrade'

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

  it('asks to remove the extra boards, matching the Free cap of 1', () => {
    const issues = freeDowngradeIssues({ maxBoards: 2 })
    expect(issues).toEqual([
      {
        key: 'maxBoards',
        message: 'You have 2 boards',
        actionLabel: 'Remove 1 board',
        href: '/admin/settings/boards',
      },
    ])
  })

  it('pluralizes seats to remove', () => {
    const issues = freeDowngradeIssues({ maxTeamSeats: 4 })
    expect(issues[0]).toMatchObject({
      message: 'You have 4 seats',
      actionLabel: 'Remove 3 seats',
    })
  })
})

describe('featuresDisabledOnFree', () => {
  it('names Pro features when the trial plan is Pro', () => {
    expect(featuresDisabledOnFree('pro')).toContain('Workflows and automations will be disabled')
    expect(featuresDisabledOnFree('pro')).toContain('MCP access will be revoked')
  })
})
