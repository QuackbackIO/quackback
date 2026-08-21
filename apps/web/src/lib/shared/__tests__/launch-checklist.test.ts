import { describe, expect, it } from 'vitest'
import { buildLaunchTasks, launchChecklistSummary, normalizeOutcome } from '../launch-checklist'
import type { LaunchStatus } from '../launch-checklist'

const base: LaunchStatus = {
  hasBoards: false,
  boardCount: 0,
  maxBoards: null,
  memberCount: 1,
  hasBranding: false,
  hasWidgetEnabled: false,
  hasWidgetInstalled: false,
  hasMessengerEnabled: false,
  hasHelpArticle: false,
  hasPublishedHelpArticle: false,
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
      hasWidgetEnabled: true,
      hasMessengerEnabled: true,
      hasWidgetInstalled: false,
    })
    expect(configured.find((task) => task.id === 'connect-messenger')?.isCompleted).toBe(false)
    expect(configured.filter((task) => task.classification === 'prerequisite')).toHaveLength(1)
  })

  it('blocks an unavailable board without adding it to the readiness denominator', () => {
    const status = { ...base, boardCount: 1, maxBoards: 1 }
    const board = buildLaunchTasks(status).find((task) => task.id === 'create-board')
    expect(board?.availability).toBe('blocked')
    expect(board?.blockedReason).toMatch(/board limit/i)
    expect(launchChecklistSummary(status).denominator).toBe(0)
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

  it('keeps deferred prerequisites pending without bypassing their dependency', () => {
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
    expect(board.isDeferred).toBe(true)
    expect(board.isCompleted).toBe(false)
    expect(tasks.find((task) => task.id === 'distribute-feedback')?.availability).toBe('blocked')
  })

  it('honors dismissal only as excluded optional polish', () => {
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
    expect(branding.isDismissed).toBe(true)
    expect(branding.isCompleted).toBe(false)
    expect(summary.denominator).toBe(2)
    expect(summary.doneCount).toBe(2)
  })

  it('keeps first win independent of readiness completion', () => {
    const summary = launchChecklistSummary({
      ...base,
      hasBoards: true,
      publicBoardLinkCopiedAt: '2026-07-13T10:00:00.000Z',
    })
    expect(summary.allComplete).toBe(true)
    expect(summary.firstWinComplete).toBe(false)
    expect(summary.resolved).toBe(false)
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
