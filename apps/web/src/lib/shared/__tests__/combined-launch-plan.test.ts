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
    expect(tasks.find((task) => task.id === 'first-win')?.title).toBe('Get your first idea')
    expect(tasks.find((task) => task.id === 'create-board')?.title).toBe(
      'Create a private team board'
    )
    expect(launchChecklistSummary(privateStatus)).toMatchObject({
      outcome: 'internal',
      headline: '2 steps to your first team idea',
    })
  }
})

it('keeps the primary goal when private feedback is secondary and keeps public feedback public', () => {
  const publicStatus: LaunchStatus = {
    ...status,
    goals: ['product_feedback'],
    feedbackPrivate: false,
  }
  expect(buildLaunchTasks(publicStatus).find((task) => task.id === 'create-board')?.title).toBe(
    'Create a feedback board'
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

it('keeps a private feedback plan open until a teammate joins, though the board is seeded', () => {
  const privateOnly: LaunchStatus = {
    ...status,
    hasBoards: true,
    hasInternalBoard: true,
    goals: ['product_feedback'],
    feedbackPrivate: true,
    features: { ...status.features!, supportInbox: false, helpCenter: false, statusPage: false },
  }
  const summary = launchChecklistSummary(privateOnly)
  expect(
    summary.tasks.filter((task) => task.classification === 'prerequisite').map((task) => task.id)
  ).toEqual(['create-board', 'invite-team'])
  expect(summary.resolved).toBe(false)
  expect(launchChecklistSummary({ ...privateOnly, memberCount: 2 }).resolved).toBe(true)
  expect(
    buildLaunchTasks({ ...privateOnly, goals: ['product_feedback', 'customer_support'] })
      .filter((task) => task.classification === 'prerequisite')
      .map((task) => task.id)
  ).toEqual(['create-board', 'invite-team'])
})

it('puts every prerequisite first, ahead of polish a goal brought in earlier', () => {
  const tasks = buildLaunchTasks({
    ...status,
    goals: ['customer_support', 'help_center'],
    features: { ...status.features!, assistant: true },
  })
  const order = tasks.map((task) => task.id)
  expect(order.slice(0, 2)).toEqual(['connect-messenger', 'help-article'])
  expect(order.indexOf('set-up-quinn')).toBeGreaterThan(order.indexOf('help-article'))
  expect(tasks.find((task) => task.id === 'set-up-quinn')?.classification).toBe('polish')
  expect(order.at(-1)).toBe('first-win')
})
