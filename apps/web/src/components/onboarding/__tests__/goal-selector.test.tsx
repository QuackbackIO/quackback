// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'react-intl'
import { afterEach, expect, it } from 'vitest'
import { GoalSelector } from '../goal-selector'
import type { OnboardingOutcome } from '@/lib/shared/db-types'

afterEach(cleanup)

function Picker() {
  const [goals, setGoals] = useState<OnboardingOutcome[]>(['product_feedback'])
  const [feedbackPrivate, setFeedbackPrivate] = useState(false)
  return (
    <GoalSelector
      goals={goals}
      onGoalsChange={setGoals}
      feedbackPrivate={feedbackPrivate}
      onPrivateChange={setFeedbackPrivate}
    />
  )
}

it('selects multiple products with the keyboard and retains the private choice', async () => {
  const user = userEvent.setup()
  render(
    <IntlProvider locale="en">
      <Picker />
    </IntlProvider>
  )
  const support = screen.getByRole('button', { name: 'Support inbox' })
  support.focus()
  await user.keyboard(' ')
  expect(support).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: 'Help center' }))
  expect(screen.getByRole('button', { name: 'Help center' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Feedback & roadmap' }))
  expect(screen.queryByRole('checkbox')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Feedback & roadmap' }))
  expect(screen.getByRole('checkbox')).toBeChecked()
})
