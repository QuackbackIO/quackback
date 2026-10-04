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
  return <GoalSelector goals={goals} onGoalsChange={setGoals} />
}

function renderPicker() {
  return render(
    <IntlProvider locale="en">
      <Picker />
    </IntlProvider>
  )
}

it('selects multiple products with the keyboard and offers no private choice', async () => {
  const user = userEvent.setup()
  renderPicker()
  const support = screen.getByRole('button', { name: 'Support inbox' })
  support.focus()
  await user.keyboard(' ')
  expect(support).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: 'Help center' }))
  expect(screen.getByRole('button', { name: 'Help center' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(screen.getByRole('button', { name: 'Feedback & roadmap' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(screen.queryByText(/private/i)).toBeNull()
})

it('says to pick at least one when the last goal is removed', async () => {
  const user = userEvent.setup()
  renderPicker()
  expect(screen.queryByText('Pick at least one')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Feedback & roadmap' }))
  expect(screen.getByText('Pick at least one')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Status page' }))
  expect(screen.queryByText('Pick at least one')).toBeNull()
})
