import { describe, expect, it } from 'vitest'
import { buildLaunchTasks, launchChecklistSummary, normalizeOutcome } from '../launch-checklist'
import type { LaunchStatus } from '../launch-checklist'

const base: LaunchStatus = {
  hasBoards: false,
  memberCount: 1,
  hasBranding: false,
  hasWidgetEnabled: false,
  hasMessengerEnabled: false,
  hasHelpArticle: false,
  hasStatusComponent: false,
  hasIntegration: false,
  useCase: null,
}

const allDoneProductFeedback: LaunchStatus = {
  ...base,
  useCase: 'product_feedback',
  hasBoards: true,
  hasWidgetEnabled: true,
  memberCount: 2,
  hasBranding: true,
  hasStatusComponent: true,
  hasIntegration: true,
}

describe('normalizeOutcome', () => {
  it('maps legacy industry values to product_feedback', () => {
    expect(normalizeOutcome('saas')).toBe('product_feedback')
    expect(normalizeOutcome('consumer')).toBe('product_feedback')
    expect(normalizeOutcome('marketplace')).toBe('product_feedback')
  })

  it('passes through new outcomes', () => {
    expect(normalizeOutcome('customer_support')).toBe('customer_support')
    expect(normalizeOutcome('help_center')).toBe('help_center')
    expect(normalizeOutcome('internal')).toBe('internal')
    expect(normalizeOutcome('product_feedback')).toBe('product_feedback')
  })

  it('defaults null/undefined to product_feedback', () => {
    expect(normalizeOutcome(null)).toBe('product_feedback')
    expect(normalizeOutcome(undefined)).toBe('product_feedback')
  })
})

describe('buildLaunchTasks', () => {
  it('orders product_feedback: board → widget → invite → logo → status page → integration', () => {
    const ids = buildLaunchTasks({ ...base, useCase: 'product_feedback' }).map((t) => t.id)
    expect(ids).toEqual([
      'create-board',
      'add-to-site',
      'invite-team',
      'customize-branding',
      'status-component',
      'connect-integration',
    ])
  })

  it('orders customer_support: messenger first', () => {
    const ids = buildLaunchTasks({ ...base, useCase: 'customer_support' }).map((t) => t.id)
    expect(ids[0]).toBe('messenger')
    expect(ids).toContain('add-to-site')
  })

  it('orders help_center: article first, no widget required', () => {
    const ids = buildLaunchTasks({ ...base, useCase: 'help_center' }).map((t) => t.id)
    expect(ids[0]).toBe('help-article')
    expect(ids).not.toContain('add-to-site')
  })

  it('internal skips status page and integrations — no external customer to show them to', () => {
    const ids = buildLaunchTasks({ ...base, useCase: 'internal' }).map((t) => t.id)
    expect(ids).toEqual(['create-board', 'invite-team', 'customize-branding'])
  })

  it('marks invite complete only when memberCount > 1', () => {
    const one = buildLaunchTasks({ ...base, memberCount: 1 }).find((t) => t.id === 'invite-team')
    const two = buildLaunchTasks({ ...base, memberCount: 2 }).find((t) => t.id === 'invite-team')
    expect(one?.isCompleted).toBe(false)
    expect(two?.isCompleted).toBe(true)
  })

  it('marks status-component and connect-integration complete from status flags', () => {
    const tasks = buildLaunchTasks({
      ...base,
      useCase: 'product_feedback',
      hasStatusComponent: true,
      hasIntegration: true,
    })
    expect(tasks.find((t) => t.id === 'status-component')?.isCompleted).toBe(true)
    expect(tasks.find((t) => t.id === 'connect-integration')?.isCompleted).toBe(true)
  })

  it('accepts an outcome override independent of stored useCase', () => {
    const ids = buildLaunchTasks({ ...base, useCase: 'product_feedback' }, 'help_center').map(
      (t) => t.id
    )
    expect(ids[0]).toBe('help-article')
  })

  it('marks a task isSkipped when its id is in skippedLaunchTasks, without affecting isCompleted', () => {
    const tasks = buildLaunchTasks({
      ...base,
      useCase: 'product_feedback',
      skippedLaunchTasks: ['customize-branding'],
    })
    const branding = tasks.find((t) => t.id === 'customize-branding')
    expect(branding?.isSkipped).toBe(true)
    expect(branding?.isCompleted).toBe(false)
    expect(tasks.find((t) => t.id === 'create-board')?.isSkipped).toBe(false)
  })
})

describe('launchChecklistSummary', () => {
  it('reports remaining and headline for incomplete product_feedback', () => {
    const s = launchChecklistSummary({ ...base, useCase: 'product_feedback', hasBoards: true })
    expect(s.tasks.filter((t) => t.isCompleted).length).toBe(1)
    expect(s.remaining).toBe(5)
    expect(s.allComplete).toBe(false)
    expect(s.headline).toMatch(/first customer response/)
  })

  it('is complete when all product_feedback tasks done', () => {
    const s = launchChecklistSummary(allDoneProductFeedback)
    expect(s.allComplete).toBe(true)
    expect(s.remaining).toBe(0)
  })

  it('counts a skipped task toward doneCount/remaining but not isCompleted', () => {
    const s = launchChecklistSummary({
      ...allDoneProductFeedback,
      hasBranding: false,
      skippedLaunchTasks: ['customize-branding'],
    })
    expect(s.tasks.filter((t) => t.isCompleted).length).toBe(5)
    expect(s.doneCount).toBe(6)
    expect(s.remaining).toBe(0)
    expect(s.allComplete).toBe(true)
  })

  it('returns the resolved outcome, honoring an override over stored useCase', () => {
    const s = launchChecklistSummary({ ...base, useCase: 'product_feedback' }, 'internal')
    expect(s.outcome).toBe('internal')
  })
})
