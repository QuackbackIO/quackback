import { describe, expect, it } from 'vitest'
import { launchPlanGroups, launchPlanProgress, type LaunchStatus } from '../launch-checklist'

const status: LaunchStatus = {
  hasBoards: true,
  hasPublicBoard: true,
  memberCount: 1,
  hasBranding: false,
  goals: ['product_feedback', 'customer_support'],
  features: {
    supportInbox: true,
    helpCenter: false,
    statusPage: false,
    integrations: true,
    assistant: true,
    changelog: true,
  },
}

const shape = (input: LaunchStatus) =>
  launchPlanGroups(input).map((group) => [group.id, group.tasks.map((task) => task.id)])

describe('launch plan groups', () => {
  it('groups goal work in goal order, with the first win under the primary goal, then polish', () => {
    expect(shape(status)).toEqual([
      ['product_feedback', ['create-board', 'distribute-feedback', 'first-win']],
      ['customer_support', ['connect-messenger', 'set-up-quinn']],
      ['polish', ['publish-changelog', 'invite-team', 'customize-branding', 'connect-integration']],
    ])
  })

  it('follows the goal order the workspace chose', () => {
    expect(
      shape({ ...status, goals: ['customer_support', 'product_feedback'] }).map(([id]) => id)
    ).toEqual(['customer_support', 'product_feedback', 'polish'])
    expect(shape({ ...status, goals: ['customer_support', 'product_feedback'] })[0]).toEqual([
      'customer_support',
      ['connect-messenger', 'set-up-quinn', 'first-win'],
    ])
  })

  it('keeps a product the plan includes outside the goals in its own group', () => {
    const legacy: LaunchStatus = {
      ...status,
      goals: undefined,
      useCase: 'product_feedback',
      features: { ...status.features!, supportInbox: false, helpCenter: true },
    }
    expect(shape(legacy).map(([id]) => id)).toEqual(['product_feedback', 'help_center', 'polish'])
  })

  it('lists every task of the plan exactly once', () => {
    const tasks = launchPlanGroups(status).flatMap((group) => group.tasks)
    expect(tasks).toHaveLength(launchPlanProgress(status).total)
    expect(new Set(tasks.map((task) => task.id)).size).toBe(tasks.length)
  })
})
