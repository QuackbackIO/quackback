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
  hasWidgetEnabled: false,
  hasMessengerEnabled: false,
  hasHelpArticle: false,
  hasPublishedChangelog: false,
  hasStatusComponent: false,
  hasIntegration: false,
  hasFirstWin: false,
  useCase: 'product_feedback',
}

const noExtraModules = {
  supportInbox: false,
  helpCenter: false,
  statusPage: false,
  integrations: true,
  changelog: false,
} as const

describe('normalizeOutcome', () => {
  it('maps legacy industries while preserving V2 outcomes', () => {
    expect(normalizeOutcome('saas')).toBe('product_feedback')
    expect(normalizeOutcome('customer_support')).toBe('customer_support')
    expect(normalizeOutcome(null)).toBe('product_feedback')
  })
})

describe('buildLaunchTasks', () => {
  it('always includes create-board and completes it on any board', () => {
    expect(buildLaunchTasks(base).find((task) => task.id === 'create-board')?.isCompleted).toBe(
      false
    )
    expect(
      buildLaunchTasks({ ...base, hasBoards: true, hasPublicBoard: false }).find(
        (task) => task.id === 'create-board'
      )?.isCompleted
    ).toBe(true)
  })

  it('hides share until a public board exists', () => {
    expect(
      buildLaunchTasks({ ...base, features: noExtraModules }).some(
        (task) => task.id === 'distribute-feedback'
      )
    ).toBe(false)
    expect(
      buildLaunchTasks({
        ...base,
        hasBoards: true,
        hasPublicBoard: false,
        features: noExtraModules,
      }).some((task) => task.id === 'distribute-feedback')
    ).toBe(false)
    expect(
      buildLaunchTasks({
        ...base,
        hasBoards: true,
        hasPublicBoard: true,
        features: noExtraModules,
      }).some((task) => task.id === 'distribute-feedback')
    ).toBe(true)
  })

  it('adds changelog by default and completes only on a published entry', () => {
    const draft = buildLaunchTasks(base).find((task) => task.id === 'publish-changelog')
    expect(draft?.isCompleted).toBe(false)
    expect(draft?.href).toBe('/admin/changelog')
    expect(
      buildLaunchTasks({ ...base, hasPublishedChangelog: true }).find(
        (task) => task.id === 'publish-changelog'
      )?.isCompleted
    ).toBe(true)
    expect(
      buildLaunchTasks({ ...base, features: noExtraModules }).some(
        (task) => task.id === 'publish-changelog'
      )
    ).toBe(false)
  })

  it('composes essentials from enabled modules', () => {
    const ids = buildLaunchTasks({
      ...base,
      features: {
        supportInbox: true,
        helpCenter: true,
        statusPage: true,
        integrations: true,
        changelog: true,
      },
    })
      .filter((task) => task.classification === 'prerequisite')
      .map((task) => task.id)
    expect(ids).toEqual([
      'create-board',
      'publish-changelog',
      'connect-messenger',
      'help-article',
      'add-status-service',
    ])
  })

  it('keeps Connect Messenger pending until installation is externally observed', () => {
    const configured = buildLaunchTasks({
      ...base,
      features: { ...noExtraModules, supportInbox: true },
      hasWidgetEnabled: true,
      hasWidgetInstalled: false,
    })
    expect(configured.find((task) => task.id === 'connect-messenger')?.isCompleted).toBe(false)
    expect(
      configured.filter((task) => task.classification === 'prerequisite').map((t) => t.id)
    ).toEqual(['create-board', 'connect-messenger'])
  })

  it('completes Connect Messenger when the SDK is observed and the widget is on', () => {
    const task = buildLaunchTasks({
      ...base,
      hasWidgetInstalled: true,
      hasWidgetEnabled: true,
      features: { ...noExtraModules, supportInbox: true },
    }).find((row) => row.id === 'connect-messenger')
    expect(task?.isCompleted).toBe(true)
  })

  it('counts a blocked board step in the readiness denominator', () => {
    const status = { ...base, boardCount: 1, maxBoards: 1, features: noExtraModules }
    const board = buildLaunchTasks(status).find((task) => task.id === 'create-board')
    expect(board?.availability).toBe('blocked')
    expect(board?.blocked?.kind).toBe('plan-limit')
    const summary = launchChecklistSummary(status)
    expect(summary.denominator).toBe(1)
    expect(summary.doneCount).toBe(0)
  })

  it('hides Help Center and Support rows when those modules are off', () => {
    const tasks = buildLaunchTasks({
      ...base,
      useCase: 'help_center',
      hasHelpArticle: true,
      features: noExtraModules,
    })
    expect(tasks.some((task) => task.id === 'help-article')).toBe(false)
    expect(tasks.some((task) => task.id === 'connect-messenger')).toBe(false)
  })

  it('removes action links when the caller lacks the responsible permission', () => {
    const tasks = buildLaunchTasks({
      ...base,
      features: noExtraModules,
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

  it('reads legacy deferred rows as skipped', () => {
    const tasks = buildLaunchTasks({
      ...base,
      features: noExtraModules,
      taskResolutions: {
        product_feedback: {
          'create-board': {
            resolution: 'deferred',
            resolvedAt: '2026-07-13T10:00:00.000Z',
          },
        },
      },
    })
    expect(tasks.find((task) => task.id === 'create-board')!.isSkipped).toBe(true)
  })

  it('excludes skipped essentials from numerator and denominator', () => {
    const summary = launchChecklistSummary({
      ...base,
      features: noExtraModules,
      taskResolutions: {
        product_feedback: {
          'create-board': {
            resolution: 'dismissed',
            resolvedAt: '2026-07-13T10:00:00.000Z',
          },
        },
      },
    })
    expect(summary.denominator).toBe(0)
    expect(summary.resolved).toBe(true)
  })

  it('treats polish dismissal as skipped without changing the essentials count', () => {
    const summary = launchChecklistSummary({
      ...base,
      hasBoards: true,
      hasPublicBoard: true,
      publicBoardLinkCopiedAt: '2026-07-13T10:00:00.000Z',
      features: noExtraModules,
      taskResolutions: {
        product_feedback: {
          'customize-branding': {
            resolution: 'dismissed',
            resolvedAt: '2026-07-13T10:00:00.000Z',
          },
        },
      },
    })
    expect(summary.denominator).toBe(2)
    expect(summary.doneCount).toBe(2)
    expect(summary.resolved).toBe(true)
  })

  it('resolves once every prerequisite is done or skipped, without waiting for the first win', () => {
    const summary = launchChecklistSummary({
      ...base,
      hasBoards: true,
      hasPublishedChangelog: true,
    })
    expect(summary.allComplete).toBe(true)
    expect(summary.firstWinComplete).toBe(false)
    expect(summary.resolved).toBe(true)
    expect(summary.percent).toBe(100)
  })

  it('hides the home card once essentials resolve, even if the first win has not landed', () => {
    expect(isLaunchPlanActive({ resolved: false, firstWinComplete: true })).toBe(true)
    expect(isLaunchPlanActive({ resolved: true, firstWinComplete: false })).toBe(false)
    expect(isLaunchPlanActive({ resolved: false, firstWinComplete: false })).toBe(true)
    expect(isLaunchPlanActive({ resolved: true, firstWinComplete: true })).toBe(false)
  })

  it('keeps invite as polish', () => {
    expect(
      buildLaunchTasks(base, 'product_feedback').find((task) => task.id === 'invite-team')
        ?.classification
    ).toBe('polish')
    expect(
      buildLaunchTasks(base, 'internal').find((task) => task.id === 'invite-team')?.classification
    ).toBe('polish')
  })

  it.each([
    { publicBoardLinkCopiedAt: '2026-08-14T10:00:00.000Z' },
    { hasWidgetInstalled: true, hasWidgetEnabled: true },
    { hasFirstWin: true },
  ])('accepts any real distribution signal: %o', (signal) => {
    const task = buildLaunchTasks({
      ...base,
      hasPublicBoard: true,
      features: noExtraModules,
      ...signal,
    }).find((candidate) => candidate.id === 'distribute-feedback')
    expect(task?.isCompleted).toBe(true)
  })
})
