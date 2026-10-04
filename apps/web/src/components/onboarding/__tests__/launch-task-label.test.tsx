// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, describe, expect, it } from 'vitest'
import en from '@/locales/en.json'
import de from '@/locales/de.json'
import type { OnboardingOutcome } from '@/lib/shared/db-types'
import { buildLaunchTasks, type LaunchStatus } from '@/lib/shared/launch-checklist'
import { LaunchTaskLabel } from '../launch-task-label'

afterEach(cleanup)

function status(goals: OnboardingOutcome[], feedbackPrivate = false): LaunchStatus {
  return {
    hasBoards: false,
    memberCount: 1,
    hasBranding: false,
    goals,
    feedbackPrivate,
    features: {
      supportInbox: true,
      helpCenter: true,
      statusPage: true,
      integrations: true,
      assistant: false,
    },
  }
}

function label(input: LaunchStatus, taskId: string, messages: Record<string, string> = en): string {
  const task = buildLaunchTasks(input).find((candidate) => candidate.id === taskId)
  if (!task) throw new Error(`no ${taskId}`)
  const { container } = render(
    <IntlProvider locale="en" messages={messages}>
      <LaunchTaskLabel task={task} />
    </IntlProvider>
  )
  const text = container.textContent ?? ''
  cleanup()
  return text
}

describe('launch task labels', () => {
  it('names the board for its audience in every catalogue', () => {
    expect(label(status(['product_feedback']), 'create-board')).toBe('Create a feedback board')
    expect(label(status(['product_feedback'], true), 'create-board')).toBe(
      'Create a private team board'
    )
    expect(label(status(['product_feedback'], true), 'create-board', de)).not.toBe(
      label(status(['product_feedback']), 'create-board', de)
    )
  })

  it.each([
    [['product_feedback'], false, 'A customer posts an idea'],
    [['product_feedback'], true, 'A teammate posts an idea'],
    [['customer_support', 'product_feedback'], false, 'A customer starts a conversation'],
    [['help_center'], false, 'A customer finds it helpful'],
    [['status_page', 'help_center'], false, 'A customer subscribes'],
  ] as const)('names the first win for goals %j (private %s): %s', (goals, isPrivate, title) => {
    expect(label(status([...goals], isPrivate), 'first-win')).toBe(title)
  })
})
