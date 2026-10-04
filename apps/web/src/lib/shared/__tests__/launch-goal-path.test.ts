import { describe, expect, it } from 'vitest'
import {
  buildLaunchTasks,
  launchGoalPath,
  launchPlanProgress,
  type LaunchStatus,
} from '../launch-checklist'

const base: LaunchStatus = {
  hasBoards: true,
  hasPublicBoard: true,
  publicBoardId: 'board_1',
  publicBoardPath: '/?board=feedback',
  memberCount: 1,
  hasBranding: false,
  hasAgentAnswering: true,
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

const ids = (tasks: { id: string }[]) => tasks.map((task) => task.id)

describe('steps the system did itself', () => {
  it('are Ready, not completed by the person', () => {
    const tasks = buildLaunchTasks(base)
    expect(tasks.find((task) => task.id === 'create-board')).toMatchObject({ isReady: true })
    expect(tasks.find((task) => task.id === 'set-up-quinn')).toMatchObject({ isReady: true })
    expect(tasks.find((task) => task.id === 'distribute-feedback')?.isReady).toBe(false)
  })

  it('do not count toward progress, while the live portal does', () => {
    // Plan rows: board and Quinn (ready), share, Messenger, changelog,
    // invite, logo, integration, first win; plus Portal is live.
    expect(launchPlanProgress(base)).toMatchObject({ done: 1, total: 8 })
    expect(launchPlanProgress({ ...base, hasBranding: true })).toMatchObject({ done: 2, total: 8 })
  })
})

describe('the goal path', () => {
  it('leads with the primary goal: one step to do, then the first result', () => {
    const path = launchGoalPath(base)
    expect(ids(path.steps)).toEqual(['distribute-feedback', 'first-win'])
    expect(path.next?.id).toBe('distribute-feedback')
    expect(ids(path.later)).toEqual(['publish-changelog', 'invite-team', 'customize-branding'])
  })

  it('moves on to the first result once the step is done', () => {
    const path = launchGoalPath({ ...base, publicBoardLinkCopiedAt: '2026-10-04T10:00:00.000Z' })
    expect(path.next?.id).toBe('first-win')
  })

  it('follows a support goal and a private team', () => {
    expect(ids(launchGoalPath({ ...base, goals: ['customer_support'] }).steps)).toEqual([
      'connect-messenger',
      'first-win',
    ])
    expect(
      ids(
        launchGoalPath({
          ...base,
          goals: ['product_feedback'],
          feedbackPrivate: true,
          hasPublicBoard: false,
        }).steps
      )
    ).toEqual(['invite-team', 'first-win'])
  })

  it('offers another goal step once the path is done', () => {
    const path = launchGoalPath({
      ...base,
      publicBoardLinkCopiedAt: '2026-10-04T10:00:00.000Z',
      hasFirstWin: true,
    })
    expect(path.next?.id).toBe('connect-messenger')
  })
})
