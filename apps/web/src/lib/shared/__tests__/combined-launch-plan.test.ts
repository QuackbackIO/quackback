import { describe, expect, it } from 'vitest'
import { buildLaunchTasks, launchChecklistSummary, type LaunchStatus } from '../launch-checklist'

const status: LaunchStatus = {
  hasBoards: false,
  memberCount: 1,
  hasBranding: false,
  goals: ['customer_support', 'help_center'],
  features: {
    supportInbox: true,
    helpCenter: true,
    statusPage: true,
    integrations: true,
    assistant: false,
    changelog: true,
  },
}

describe('combined launch plan', () => {
  it('includes chosen goal prerequisites in goal order without unrelated product work', () => {
    const tasks = buildLaunchTasks(status, ['customer_support', 'help_center'])
    expect(tasks.filter((t) => t.classification === 'prerequisite').map((t) => t.id)).toEqual([
      'connect-messenger',
      'help-article',
    ])
    expect(tasks.some((t) => t.id === 'create-board' || t.id === 'add-status-service')).toBe(false)
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length)
  })
  it('orders feedback prerequisites before support when feedback is selected first', () => {
    const tasks = buildLaunchTasks({ ...status, hasPublicBoard: true }, [
      'product_feedback',
      'customer_support',
    ])
    expect(tasks.filter((t) => t.classification === 'prerequisite').map((t) => t.id)).toEqual([
      'create-board',
      'distribute-feedback',
      'connect-messenger',
    ])
  })
  it('summarizes the complete goal list and uses the first goal for the win', () => {
    const summary = launchChecklistSummary({ ...status, hasHelpArticle: true })
    expect(summary.denominator).toBe(2)
    expect(summary.doneCount).toBe(1)
    expect(summary.outcome).toBe('customer_support')
  })
  it('uses adding a service as the status prerequisite', () => {
    expect(
      buildLaunchTasks(status, ['status_page'])
        .filter((t) => t.classification === 'prerequisite')
        .map((t) => t.id)
    ).toEqual(['add-status-service'])
  })
})
