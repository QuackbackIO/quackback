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
  it('keeps Messenger configured and externally installed as separate facts', () => {
    const configured = buildLaunchTasks({
      ...base,
      useCase: 'customer_support',
      hasWidgetEnabled: true,
      hasMessengerEnabled: true,
      hasWidgetInstalled: false,
    })
    expect(configured.find((task) => task.id === 'messenger')?.isCompleted).toBe(true)
    expect(configured.find((task) => task.id === 'install-messenger')?.isCompleted).toBe(false)
  })

  it('blocks an unavailable board without adding it to the readiness denominator', () => {
    const status = { ...base, boardCount: 1, maxBoards: 1 }
    const board = buildLaunchTasks(status).find((task) => task.id === 'create-board')
    expect(board?.availability).toBe('blocked')
    expect(board?.blockedReason).toMatch(/board limit/i)
    expect(launchChecklistSummary(status).denominator).toBe(2)
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

  it('keeps deferred prerequisites pending and deprioritizes them only behind another action', () => {
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
    expect(tasks.indexOf(board)).toBeGreaterThan(
      tasks.findIndex((task) => task.id === 'add-to-site')
    )
  })

  it('honors dismissal only as excluded optional polish', () => {
    const summary = launchChecklistSummary({
      ...base,
      hasBoards: true,
      hasWidgetInstalled: true,
      memberCount: 2,
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
    expect(summary.denominator).toBe(3)
    expect(summary.doneCount).toBe(3)
  })

  it('keeps first win independent of readiness completion', () => {
    const summary = launchChecklistSummary({
      ...base,
      hasBoards: true,
      hasWidgetInstalled: true,
      memberCount: 2,
    })
    expect(summary.allComplete).toBe(true)
    expect(summary.firstWinComplete).toBe(false)
    expect(summary.resolved).toBe(false)
  })

  it('uses only the current goal task set', () => {
    const ids = buildLaunchTasks({ ...base, useCase: 'help_center' }).map((task) => task.id)
    expect(ids).toContain('help-article')
    expect(ids).not.toContain('create-board')
    expect(ids).not.toContain('add-to-site')
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
})
