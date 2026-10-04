import { describe, expect, it } from 'vitest'
import { getSetupState } from '@/lib/shared/db-types'
import { buildLaunchTasks, launchOutcome, launchPath, type LaunchStatus } from '../launch-checklist'

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
  it('shares the status page and adds a service for the status goal', () => {
    expect(
      buildLaunchTasks(status, ['status_page'])
        .filter((t) => t.classification === 'prerequisite')
        .map((t) => t.id)
    ).toEqual(['add-status-service', 'share-status-page'])
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
    expect(tasks.find((task) => task.id === 'first-win')?.title).toBe('A teammate posts an idea')
    expect(tasks.find((task) => task.id === 'create-board')?.title).toBe(
      'Create a private team board'
    )
    expect(launchOutcome(privateStatus)).toBe('internal')
    expect(launchPath(privateStatus)).toMatchObject({ goal: 'private', step: 2 })
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
  expect(launchOutcome(publicStatus)).toBe('product_feedback')

  const helpStatus: LaunchStatus = {
    ...status,
    goals: ['help_center', 'product_feedback'],
    feedbackPrivate: true,
  }
  expect(buildLaunchTasks(helpStatus).find((task) => task.id === 'first-win')?.title).toBe(
    'A customer finds it helpful'
  )
  expect(launchOutcome(helpStatus)).toBe('help_center')
})

it('keeps a private feedback plan open until a teammate posts, though the board is seeded', () => {
  const privateOnly: LaunchStatus = {
    ...status,
    hasBoards: true,
    hasInternalBoard: true,
    goals: ['product_feedback'],
    feedbackPrivate: true,
    features: { ...status.features!, supportInbox: false, helpCenter: false, statusPage: false },
  }
  expect(
    buildLaunchTasks(privateOnly)
      .filter((task) => task.classification === 'prerequisite')
      .map((task) => task.id)
  ).toEqual(['create-board', 'invite-team'])
  expect(launchPath(privateOnly).complete).toBe(false)
  expect(launchPath({ ...privateOnly, memberCount: 2 })).toMatchObject({ step: 3, complete: false })
  expect(launchPath({ ...privateOnly, memberCount: 2, hasFirstWin: true }).complete).toBe(true)
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

it('leaves out a step the plan does not include', () => {
  const ids = (input: LaunchStatus) => buildLaunchTasks(input).map((task) => task.id)
  expect(ids(status)).toContain('connect-integration')
  expect(ids({ ...status, features: { ...status.features!, integrations: false } })).not.toContain(
    'connect-integration'
  )
})
