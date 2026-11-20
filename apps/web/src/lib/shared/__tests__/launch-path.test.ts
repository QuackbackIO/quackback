import { describe, expect, it } from 'vitest'
import {
  buildLaunchTasks,
  isLaunchPlanActive,
  launchPath,
  launchPlanProgress,
  launchVisibilityHref,
  openLaterSteps,
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

const boardlessStatus = (
  goals: LaunchStatus['goals'],
  features: LaunchStatus['features']
): LaunchStatus => ({ ...base, goals, features, hasBoards: false, hasPublicBoard: false })
const ids = (tasks: { id: string }[]) => tasks.map((task) => task.id)
const copied = '2026-10-04T10:00:00.000Z'

describe('the launch path', () => {
  it('is four steps for a customer-facing goal: live page, brand, goal step, customer win', () => {
    const path = launchPath(base)
    expect(path.goal).toBe('feedback')
    expect(path.total).toBe(4)
    expect(path.step).toBe(2)
    expect(ids(path.steps)).toEqual(['customize-branding', 'distribute-feedback', 'first-win'])
    expect(path.steps[0]!.title).toBe('Make it look like your brand')
    expect(path.steps[1]!.title).toBe('Share your board link')
    expect(path.steps[2]!.title).toBe('A customer creates a post')
    expect(path.next?.id).toBe('customize-branding')
    expect(ids(path.later)).not.toContain('customize-branding')
  })

  it('moves on to the goal step once the brand is set', () => {
    const path = launchPath({ ...base, hasBranding: true })
    expect(path.step).toBe(3)
    expect(path.next?.id).toBe('distribute-feedback')
  })

  it('leads with the goal step when the brand step is skipped, and keeps it on the path', () => {
    const path = launchPath({
      ...base,
      taskResolutions: {
        product_feedback: {
          'customize-branding': { resolution: 'dismissed', resolvedAt: copied },
        },
      },
    })
    expect(ids(path.steps)).toContain('customize-branding')
    expect(path.step).toBe(3)
    expect(path.next?.id).toBe('distribute-feedback')
  })

  it('waits for the win once the brand step is skipped and the goal step is done', () => {
    const path = launchPath({
      ...base,
      publicBoardLinkCopiedAt: copied,
      taskResolutions: {
        product_feedback: {
          'customize-branding': { resolution: 'deferred', resolvedAt: copied },
        },
      },
    })
    expect(path.step).toBe(4)
    expect(path.total).toBe(4)
    expect(path.next?.id).toBe('first-win')
    expect(path.complete).toBe(false)
  })

  it('counts a goal step skipped before it joined the path, as the Next pointer does', () => {
    const path = launchPath({
      ...base,
      hasBranding: true,
      taskResolutions: {
        product_feedback: {
          'distribute-feedback': { resolution: 'dismissed', resolvedAt: copied },
        },
      },
    })
    expect(path.step).toBe(4)
    expect(path.next?.id).toBe('first-win')
  })

  it('does not count a brand step the viewer may not change', () => {
    const path = launchPath({
      ...base,
      permissions: {
        settingsManage: true,
        boardManage: true,
        memberManage: true,
        brandingManage: false,
        integrationManage: true,
        helpCenterManage: true,
        assistantManage: true,
      },
    })
    expect(path.step).toBe(2)
  })

  it('leads with the goal step for someone who may not change the brand', () => {
    const path = launchPath({
      ...base,
      permissions: {
        settingsManage: true,
        boardManage: true,
        memberManage: true,
        brandingManage: false,
        integrationManage: true,
        helpCenterManage: true,
        assistantManage: true,
      },
    })
    expect(path.next?.id).toBe('distribute-feedback')
  })

  it('still leads with the brand step when the goal step was done first', () => {
    const path = launchPath({ ...base, publicBoardLinkCopiedAt: copied })
    expect(path.step).toBe(3)
    expect(path.next?.id).toBe('customize-branding')
  })

  it('waits at the last step for the win once the brand and the goal step are done', () => {
    const path = launchPath({ ...base, hasBranding: true, publicBoardLinkCopiedAt: copied })
    expect(path.step).toBe(4)
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
    expect(launchPlanProgress(chores)).toEqual({ step: 4, total: 4, resolved: false })
  })

  it('closes on the first win, even before the goal step', () => {
    const won = { ...base, hasFirstWin: true }
    expect(launchPath(won).complete).toBe(true)
    expect(launchPath(won).next).toBeNull()
    expect(isLaunchPlanActive(won)).toBe(false)
    expect(launchPlanProgress(won)).toEqual({ step: 4, total: 4, resolved: true })
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
      expect(ids(path.steps)).toEqual(['customize-branding', step, 'first-win'])
      expect(path.steps[2]!.title).toBe(win)
    }
  })

  it('falls back to a real feedback step when the primary module is turned off', () => {
    const cases: [
      NonNullable<LaunchStatus['goals']>,
      'supportInbox' | 'helpCenter' | 'statusPage',
    ][] = [
      [['customer_support'], 'supportInbox'],
      [['help_center'], 'helpCenter'],
      [['status_page'], 'statusPage'],
    ]
    for (const [goals, module] of cases) {
      const features = { ...base.features!, [module]: false }
      const shared = launchPath({ ...base, goals, features })
      expect(shared.goal).toBe('feedback')
      expect(shared.steps[1]!.id).toBe('distribute-feedback')
      expect(shared.next?.id).toBe('customize-branding')
      expect(shared.step).toBe(2)

      const boardless = launchPath(boardlessStatus(goals, features))
      expect(boardless.steps[1]!.id).toBe('create-board')
      expect(launchPath({ ...boardlessStatus(goals, features), hasBranding: true }).next?.id).toBe(
        'create-board'
      )
      expect(ids(boardless.later)).not.toContain('create-board')
    }
  })

  it('keeps an existing private team board on its own path', () => {
    const path = launchPath({ ...base, goals: ['product_feedback'], feedbackPrivate: true })
    expect(path.goal).toBe('private')
    expect(path.total).toBe(3)
    expect(ids(path.steps)).toEqual(['invite-team', 'first-win'])
    expect(path.steps[1]!.title).toBe('A teammate creates a post')
  })

  it('keeps the brand step under Later, renamed, for a team-only board', () => {
    const path = launchPath({ ...base, goals: ['product_feedback'], feedbackPrivate: true })
    const brand = path.later.find((task) => task.id === 'customize-branding')
    expect(brand?.title).toBe('Make it look like your brand')
    expect(path.next?.id).toBe('invite-team')
  })

  it('counts an unfinished brand step with the optional steps once the plan is done', () => {
    const open = (status: LaunchStatus) => ids(openLaterSteps(launchPath(status)))
    expect(open(base)).not.toContain('customize-branding')
    expect(open({ ...base, hasFirstWin: true })[0]).toBe('customize-branding')
    expect(open({ ...base, hasFirstWin: true, hasBranding: true })).not.toContain(
      'customize-branding'
    )
  })

  it('puts every other step under later, never the path or what setup did', () => {
    const later = ids(launchPath(base).later)
    expect(later).not.toContain('distribute-feedback')
    expect(later).not.toContain('first-win')
    expect(later).not.toContain('create-board')
    expect(later).toEqual(expect.arrayContaining(['connect-messenger', 'invite-team']))
    expect(later).not.toContain('customize-branding')
  })

  it('never offers an integration below the plan that includes it', () => {
    expect(ids(buildLaunchTasks(base))).not.toContain('connect-integration')
    expect(ids(buildLaunchTasks({ ...base, features: undefined }))).not.toContain(
      'connect-integration'
    )
  })

  it('deep links the brand step to the Customise editor and a service to the components view', () => {
    const tasks = buildLaunchTasks({ ...base, goals: ['status_page', 'product_feedback'] })
    const brand = tasks.find((task) => task.id === 'customize-branding')
    expect(brand?.href).toBe('/admin/settings/portal/customise')
    expect(brand?.description).toBe('Bring in your logo, colours and font from your website.')
    const service = tasks.find((task) => task.id === 'add-status-service')
    expect(service?.href).toBe('/admin/status')
    expect(service?.search).toEqual({ view: 'components' })
  })

  it('treats the service setup seeds as Ready, leaving sharing the page as the step', () => {
    const status = {
      ...base,
      goals: ['status_page' as const],
      hasStatusComponent: true,
      hasBranding: true,
    }
    const path = launchPath(status)
    expect(path.next?.id).toBe('share-status-page')
    expect(path.later.map((task) => task.id)).not.toContain('add-status-service')
  })

  it('links each goal to the control that keeps its page private', () => {
    expect(launchVisibilityHref('feedback', { ...base, publicBoardSlug: 'feedback' })).toBe(
      '/admin/settings/boards/feedback?tab=access'
    )
    expect(launchVisibilityHref('status', base)).toBe('/admin/settings/status')
    expect(launchVisibilityHref('helpCenter', base)).toBe('/admin/settings/security/authentication')
    expect(launchVisibilityHref('support', base)).toBeNull()
  })

  it('sends a private path to the team board access, never a public board', () => {
    const both = { ...base, publicBoardSlug: 'feedback', teamBoardSlug: 'team-ideas' }
    expect(launchVisibilityHref('private', both)).toBe(
      '/admin/settings/boards/team-ideas?tab=access'
    )
    expect(launchVisibilityHref('private', { ...base, publicBoardSlug: 'feedback' })).toBe(
      '/admin/settings/boards'
    )
    expect(launchVisibilityHref('feedback', both)).toBe(
      '/admin/settings/boards/feedback?tab=access'
    )
  })

  it('completes sharing the status page when its link is copied', () => {
    const status = { ...base, goals: ['status_page' as const] }
    expect(launchPath(status).step).toBe(2)
    expect(launchPath({ ...status, statusLinkCopiedAt: copied }).step).toBe(3)
  })
})
