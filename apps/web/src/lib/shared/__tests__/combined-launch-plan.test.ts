import { describe, expect, it } from 'vitest'
import { getSetupState } from '@/lib/shared/db-types'
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

it('names the first win and summary for private team feedback, including legacy setup state', () => {
  const legacy = getSetupState(
    JSON.stringify({
      version: 2,
      steps: { core: true, workspace: true, startingPoint: null },
      useCase: 'internal',
    })
  )!
  for (const intent of [
    { goals: ['product_feedback' as const], feedbackPrivate: true },
    { goals: legacy.goals, useCase: legacy.useCase, feedbackPrivate: legacy.feedbackPrivate },
  ]) {
    const privateStatus: LaunchStatus = {
      ...status,
      ...intent,
      features: { ...status.features!, supportInbox: false, helpCenter: false, statusPage: false },
    }
    const tasks = buildLaunchTasks(privateStatus)
    expect(tasks.find((task) => task.id === 'first-win')?.title).toBe(
      'Collect your first team idea'
    )
    expect(tasks.find((task) => task.id === 'create-board')?.title).toBe(
      'Create a private team board'
    )
    expect(launchChecklistSummary(privateStatus)).toMatchObject({
      outcome: 'internal',
      headline: '1 step to your first team idea',
    })
  }
})

it('keeps the primary goal when private feedback is secondary and keeps public feedback public', () => {
  const publicStatus: LaunchStatus = {
    ...status,
    goals: ['product_feedback'],
    feedbackPrivate: false,
  }
  expect(buildLaunchTasks(publicStatus).find((task) => task.id === 'first-win')?.title).toBe(
    'Receive your first customer post or vote'
  )
  expect(launchChecklistSummary(publicStatus).outcome).toBe('product_feedback')

  const helpStatus: LaunchStatus = {
    ...status,
    goals: ['help_center', 'product_feedback'],
    feedbackPrivate: true,
  }
  expect(buildLaunchTasks(helpStatus).find((task) => task.id === 'first-win')?.title).toBe(
    'Publish your first article'
  )
  expect(launchChecklistSummary(helpStatus).outcome).toBe('help_center')
})
