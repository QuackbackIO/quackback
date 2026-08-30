import { describe, expect, it } from 'vitest'
import {
  buildLaunchTasks,
  isLaunchPlanActive,
  launchChecklistSummary,
  normalizeOutcome,
} from '../launch-checklist'
import type { LaunchStatus } from '../launch-checklist'

const base: LaunchStatus = {
  hasBoards: false,
  boardCount: 0,
  maxBoards: null,
  memberCount: 1,
  hasBranding: false,
  hasWidgetInstalled: false,
  hasMessengerEnabled: false,
  hasHelpArticle: false,
  hasIntegration: false,
  hasFirstWin: false,
  useCase: 'product_feedback',
}

describe('normalizeOutcome', () => {
  it('maps legacy industries while preserving V2 outcomes', () => {
    expect(normalizeOutcome('saas')).toBe('product_feedback')
    expect(normalizeOutcome('customer_support')).toBe('customer_support')
    expect(normalizeOutcome(null)).toBe('product_feedback')
  })
})

describe('buildLaunchTasks V2', () => {
  it('keeps Connect Messenger pending until installation is externally observed', () => {
    const configured = buildLaunchTasks({
      ...base,
      useCase: 'customer_support',
      hasMessengerEnabled: true,
      hasWidgetInstalled: false,
    })
    expect(configured.find((task) => task.id === 'connect-messenger')?.isCompleted).toBe(false)
    expect(configured.filter((task) => task.classification === 'prerequisite')).toHaveLength(1)
  })

  it('keeps Connect Messenger pending until Messenger is actually live', () => {
    const task = buildLaunchTasks({
      ...base,
      useCase: 'customer_support',
      hasWidgetInstalled: true,
      hasMessengerEnabled: false,
      features: {
        supportInbox: true,
        helpCenter: false,
        statusPage: false,
        integrations: true,
      },
    }).find((row) => row.id === 'connect-messenger')
    expect(task?.isCompleted).toBe(false)
  })

  it('completes Connect Messenger when the SDK is observed and Messenger is live', () => {
    const task = buildLaunchTasks({
      ...base,
      useCase: 'customer_support',
      hasWidgetInstalled: true,
      hasMessengerEnabled: true,
      features: {
        supportInbox: true,
        helpCenter: false,
        statusPage: false,
        integrations: true,
      },
    }).find((row) => row.id === 'connect-messenger')
    expect(task?.isCompleted).toBe(true)
  })

  it('counts a blocked board step in the readiness denominator', () => {
    const status = { ...base, boardCount: 1, maxBoards: 1 }
    const board = buildLaunchTasks(status).find((task) => task.id === 'create-board')
    expect(board?.availability).toBe('blocked')
    expect(board?.blocked?.kind).toBe('plan-limit')
    expect(board?.blockedReason).toMatch(/board limit/i)
    const summary = launchChecklistSummary(status)
    expect(summary.denominator).toBeGreaterThan(0)
    expect(summary.doneCount).toBe(0)
  })

  it('keeps a Help Center article blocked when the product is later turned off', () => {
    const summary = launchChecklistSummary({
      ...base,
      useCase: 'help_center',
      hasHelpArticle: true,
      features: {
        supportInbox: false,
        helpCenter: false,
        statusPage: false,
        integrations: true,
      },
    })
    const article = summary.tasks.find((task) => task.id === 'help-article')
    expect(article?.isCompleted).toBe(false)
    expect(article?.blocked).toEqual({ kind: 'module-off', productId: 'helpCenter' })
    expect(summary.resolved).toBe(false)
  })

  it('keeps Connect Messenger blocked when Support is later turned off', () => {
    const task = buildLaunchTasks({
      ...base,
      useCase: 'customer_support',
      hasWidgetInstalled: true,
      features: {
        supportInbox: false,
        helpCenter: false,
        statusPage: false,
        integrations: true,
      },
    }).find((row) => row.id === 'connect-messenger')
    expect(task?.isCompleted).toBe(false)
    expect(task?.blocked).toEqual({ kind: 'module-off', productId: 'support' })
  })

  it('counts a blocked Help Center step as 0/1, never 0/0', () => {
    const summary = launchChecklistSummary({
      ...base,
      useCase: 'help_center',
      features: {
        supportInbox: false,
        helpCenter: false,
        statusPage: false,
        integrations: true,
      },
    })
    const article = summary.tasks.find((task) => task.id === 'help-article')
    expect(article?.availability).toBe('blocked')
    expect(article?.blocked).toEqual({ kind: 'module-off', productId: 'helpCenter' })
    expect(summary.denominator).toBe(1)
    expect(summary.doneCount).toBe(0)
    expect(summary.blockedCount).toBe(1)
    expect(summary.remaining).toBe(1)
  })

  it('removes action links when the caller lacks the responsible permission', () => {
    const tasks = buildLaunchTasks({
      ...base,
      permissions: {
        settingsManage: false,
        boardManage: false,
        memberManage: false,
        brandingManage: false,
        integrationManage: false,
        helpCenterManage: false,
      },
    })
    expect(tasks.filter((task) => task.href)).toHaveLength(0)
    expect(tasks.find((task) => task.id === 'create-board')?.availability).toBe('blocked')
  })

  it('reads legacy deferred rows as skipped without bypassing their dependency', () => {
    const tasks = buildLaunchTasks({
      ...base,
      taskResolutions: {
        product_feedback: {
          'create-board': {
            resolution: 'deferred',
            resolvedAt: '2026-07-13T10:00:00.000Z',
          },
        },
      },
    })
    const board = tasks.find((task) => task.id === 'create-board')!
    expect(board.isSkipped).toBe(true)
    expect(board.isCompleted).toBe(false)
    expect(tasks.find((task) => task.id === 'distribute-feedback')?.availability).toBe('blocked')
  })

  it('excludes skipped essentials from numerator and denominator', () => {
    const summary = launchChecklistSummary({
      ...base,
      taskResolutions: {
        product_feedback: {
          'create-board': {
            resolution: 'dismissed',
            resolvedAt: '2026-07-13T10:00:00.000Z',
          },
        },
      },
    })
    const board = summary.tasks.find((task) => task.id === 'create-board')!
    expect(board.isSkipped).toBe(true)
    expect(summary.skippedTasks.map((task) => task.id)).toContain('create-board')
    expect(summary.denominator).toBe(1)
    expect(summary.doneCount).toBe(0)
    expect(summary.resolved).toBe(false)
  })

  it('treats polish dismissal as skipped without changing the essentials count', () => {
    const summary = launchChecklistSummary({
      ...base,
      hasBoards: true,
      publicBoardLinkCopiedAt: '2026-07-13T10:00:00.000Z',
      taskResolutions: {
        product_feedback: {
          'customize-branding': {
            resolution: 'dismissed',
            resolvedAt: '2026-07-13T10:00:00.000Z',
          },
        },
      },
    })
    const branding = summary.tasks.find((task) => task.id === 'customize-branding')!
    expect(branding.isSkipped).toBe(true)
    expect(branding.isCompleted).toBe(false)
    expect(summary.denominator).toBe(2)
    expect(summary.doneCount).toBe(2)
  })

  it('resolves once every prerequisite is done or skipped, without waiting for the first win', () => {
    const summary = launchChecklistSummary({
      ...base,
      hasBoards: true,
      publicBoardLinkCopiedAt: '2026-07-13T10:00:00.000Z',
    })
    expect(summary.allComplete).toBe(true)
    expect(summary.firstWinComplete).toBe(false)
    expect(summary.resolved).toBe(true)
  })

  it('keeps the launch-plan nav until essentials resolve, even if the first win arrived early', () => {
    expect(isLaunchPlanActive({ resolved: false, firstWinComplete: true })).toBe(true)
    expect(isLaunchPlanActive({ resolved: true, firstWinComplete: false })).toBe(true)
    expect(isLaunchPlanActive({ resolved: false, firstWinComplete: false })).toBe(true)
    expect(isLaunchPlanActive({ resolved: true, firstWinComplete: true })).toBe(false)
  })

  it('resolves an all-skipped essentials list and hides it from the count', () => {
    const summary = launchChecklistSummary({
      ...base,
      useCase: 'help_center',
      features: {
        supportInbox: false,
        helpCenter: true,
        statusPage: false,
        integrations: true,
      },
      taskResolutions: {
        help_center: {
          'help-article': {
            resolution: 'deferred',
            resolvedAt: '2026-07-13T10:00:00.000Z',
          },
        },
      },
    })
    expect(summary.denominator).toBe(0)
    expect(summary.doneCount).toBe(0)
    expect(summary.skippedTasks).toHaveLength(1)
    expect(summary.resolved).toBe(true)
    expect(summary.firstWinComplete).toBe(false)
  })

  it('uses the write-article copy for the Help Center essential', () => {
    const task = buildLaunchTasks({
      ...base,
      useCase: 'help_center',
      features: {
        supportInbox: false,
        helpCenter: true,
        statusPage: false,
        integrations: true,
      },
    }).find((row) => row.id === 'help-article')
    expect(task?.title).toBe('Write your first article')
    expect(task?.description).toMatch(/first answer/i)
    expect(task?.actionLabel).toBe('Write article')
  })

  it('uses only the current goal task set', () => {
    const ids = buildLaunchTasks({ ...base, useCase: 'help_center' }).map((task) => task.id)
    expect(ids).toContain('help-article')
    expect(ids).not.toContain('create-board')
    expect(ids).not.toContain('distribute-feedback')
  })

  it('requires a board with the right audience after the workspace goal changes', () => {
    const status = {
      ...base,
      hasBoards: true,
      hasPublicBoard: true,
      hasInternalBoard: false,
    }
    expect(
      buildLaunchTasks(status, 'product_feedback').find((task) => task.id === 'create-board')
        ?.isCompleted
    ).toBe(true)
    expect(
      buildLaunchTasks(status, 'internal').find((task) => task.id === 'create-board')?.isCompleted
    ).toBe(false)
  })

  it('treats invitations as optional except for internal feedback', () => {
    expect(
      buildLaunchTasks(base, 'product_feedback').find((task) => task.id === 'invite-team')
        ?.classification
    ).toBe('polish')
    expect(
      buildLaunchTasks(base, 'internal').find((task) => task.id === 'invite-team')?.classification
    ).toBe('prerequisite')
  })

  it.each([
    ['product_feedback', 'Receive your first customer post or vote'],
    ['customer_support', 'Receive your first customer conversation'],
    ['help_center', 'Publish your first article'],
    ['internal', 'Collect your first team idea'],
  ] as const)('first-win title for %s', (useCase, title) => {
    const task = buildLaunchTasks({ ...base, useCase }).find((row) => row.id === 'first-win')
    expect(task?.title).toBe(title)
    expect(task?.classification).toBe('first_win')
  })

  it.each([
    { publicBoardLinkCopiedAt: '2026-08-14T10:00:00.000Z' },
    { hasWidgetInstalled: true },
    { hasFirstWin: true },
  ])('accepts any real distribution signal: %o', (signal) => {
    const task = buildLaunchTasks({ ...base, hasPublicBoard: true, ...signal }).find(
      (candidate) => candidate.id === 'distribute-feedback'
    )
    expect(task?.isCompleted).toBe(true)
  })
})
