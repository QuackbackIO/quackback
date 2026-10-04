import { describe, expect, it } from 'vitest'
import {
  buildLaunchTasks,
  isLaunchPlanActive,
  launchPath,
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
    helpCenter: true,
    statusPage: true,
    integrations: false,
    assistant: true,
    changelog: true,
  },
}

const ids = (tasks: { id: string }[]) => tasks.map((task) => task.id)
const copied = '2026-10-04T10:00:00.000Z'

describe('the launch path', () => {
  it('is three steps: the live page, the goal step, then a customer win', () => {
    const path = launchPath(base)
    expect(path.goal).toBe('feedback')
    expect(path.total).toBe(3)
    expect(path.step).toBe(2)
    expect(ids(path.steps)).toEqual(['distribute-feedback', 'first-win'])
    expect(path.steps[0].title).toBe('Share your board link')
    expect(path.steps[1].title).toBe('A customer posts an idea')
    expect(path.next?.id).toBe('distribute-feedback')
  })

  it('moves to step 3 once the goal step is done, and waits there for the win', () => {
    const path = launchPath({ ...base, publicBoardLinkCopiedAt: copied })
    expect(path.step).toBe(3)
    expect(path.next?.id).toBe('first-win')
    expect(path.complete).toBe(false)
  })

  it('stays open when every chore is done but no customer has acted', () => {
    const chores: LaunchStatus = {
      ...base,
      publicBoardLinkCopiedAt: copied,
      hasBranding: true,
      memberCount: 3,
      hasPublishedChangelog: true,
      hasWidgetInstalled: true,
      hasWidgetEnabled: true,
      hasHelpArticle: true,
      hasStatusComponent: true,
    }
    expect(launchPath(chores).complete).toBe(false)
    expect(isLaunchPlanActive(chores)).toBe(true)
    expect(launchPlanProgress(chores)).toEqual({ step: 3, total: 3, resolved: false })
  })

  it('closes on the first win, even before the goal step', () => {
    const won = { ...base, hasFirstWin: true }
    expect(launchPath(won).complete).toBe(true)
    expect(launchPath(won).next).toBeNull()
    expect(isLaunchPlanActive(won)).toBe(false)
    expect(launchPlanProgress(won)).toEqual({ step: 3, total: 3, resolved: true })
  })

  it('follows each goal with its own step and win', () => {
    const cases: [LaunchStatus['goals'], string, string, string][] = [
      [['customer_support'], 'support', 'connect-messenger', 'A customer starts a conversation'],
      [['help_center'], 'helpCenter', 'help-article', 'A customer finds it helpful'],
      [['status_page'], 'status', 'share-status-page', 'A customer subscribes'],
    ]
    for (const [goals, goal, step, win] of cases) {
      const path = launchPath({ ...base, goals })
      expect(path.goal).toBe(goal)
      expect(path.steps[0].id).toBe(step)
      expect(path.steps[1].title).toBe(win)
    }
  })

  it('keeps an existing private team board on its own path', () => {
    const path = launchPath({ ...base, goals: ['product_feedback'], feedbackPrivate: true })
    expect(path.goal).toBe('private')
    expect(path.steps[0].id).toBe('invite-team')
    expect(path.steps[1].title).toBe('A teammate posts an idea')
  })

  it('puts every other step under later, never the path or what setup did', () => {
    const later = ids(launchPath(base).later)
    expect(later).not.toContain('distribute-feedback')
    expect(later).not.toContain('first-win')
    expect(later).not.toContain('create-board')
    expect(later).toEqual(
      expect.arrayContaining(['connect-messenger', 'invite-team', 'customize-branding'])
    )
  })

  it('never offers an integration below the plan that includes it', () => {
    expect(ids(buildLaunchTasks(base))).not.toContain('connect-integration')
    expect(ids(buildLaunchTasks({ ...base, features: undefined }))).not.toContain(
      'connect-integration'
    )
  })

  it('deep links the logo to General settings and a service to the components view', () => {
    const tasks = buildLaunchTasks({ ...base, goals: ['status_page', 'product_feedback'] })
    expect(tasks.find((task) => task.id === 'customize-branding')?.href).toBe(
      '/admin/settings/general'
    )
    const service = tasks.find((task) => task.id === 'add-status-service')
    expect(service?.href).toBe('/admin/status')
    expect(service?.search).toEqual({ view: 'components' })
  })

  it('completes sharing the status page when its link is copied', () => {
    const status = { ...base, goals: ['status_page' as const] }
    expect(launchPath(status).step).toBe(2)
    expect(launchPath({ ...status, statusLinkCopiedAt: copied }).step).toBe(3)
  })
})
