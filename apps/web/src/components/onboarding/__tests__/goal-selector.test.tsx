// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'react-intl'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it } from 'vitest'
import { GoalSelector } from '../goal-selector'
import type { OnboardingOutcome } from '@/lib/shared/db-types'

afterEach(cleanup)

function Picker({ initial }: { initial: OnboardingOutcome[] }) {
  const [goals, setGoals] = useState<OnboardingOutcome[]>(initial)
  return (
    <>
      <GoalSelector goals={goals} onGoalsChange={setGoals} />
      <output data-testid="order">{goals.join(',')}</output>
    </>
  )
}

function renderPicker(initial: OnboardingOutcome[] = ['product_feedback']) {
  return render(
    <IntlProvider locale="en">
      <Picker initial={initial} />
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

// The group is named by its question alone; the hint describes it.
it('names the group by its question and describes it with the hint', () => {
  renderPicker()
  const group = screen.getByRole('group', { name: 'What do you want to run first?' })
  const hint = document.getElementById(group.getAttribute('aria-describedby')!.split(' ')[0]!)
  expect(hint).toHaveTextContent('Pick any')
  expect(hint?.tagName).toBe('P')
  // Nothing in the group is a live region: toggling a goal announces nothing.
  expect(group.querySelector('[aria-live]')).toBeNull()
})

// Only the moment of consequence is announced: trying to continue with nothing
// picked. Removing a goal on its way to picking another stays quiet.
it('asks for a pick only when the form needs one', async () => {
  const user = userEvent.setup()
  const { rerender } = renderPicker()
  await user.click(screen.getByRole('button', { name: 'Feedback & roadmap' }))
  expect(screen.queryByText('Pick at least one')).toBeNull()

  rerender(
    <IntlProvider locale="en">
      <GoalSelector goals={[]} onGoalsChange={() => {}} required />
    </IntlProvider>
  )
  expect(screen.getByRole('alert')).toHaveTextContent('Pick at least one')

  rerender(
    <IntlProvider locale="en">
      <GoalSelector goals={['status_page']} onGoalsChange={() => {}} required />
    </IntlProvider>
  )
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByText('Pick any')).toBeInTheDocument()
})

// The first pick is the goal the launch plan starts with, so the screen says
// which one that is, and the order picked is the order kept.
it('marks the first pick as where the launch plan starts, and keeps pick order', async () => {
  const user = userEvent.setup()
  renderPicker([])
  expect(screen.queryByText('Starts here')).toBeNull()
  expect(screen.queryByText(/launch plan starts with/)).toBeNull()

  const support = screen.getByRole('button', { name: 'Support inbox' })
  const help = screen.getByRole('button', { name: 'Help center' })
  await user.click(support)
  await user.click(help)

  expect(screen.getByTestId('order')).toHaveTextContent('customer_support,help_center')
  expect(screen.getAllByText('Starts here')).toHaveLength(1)
  expect(support).toHaveAccessibleDescription(/Starts here/)
  expect(help).not.toHaveAccessibleDescription(/Starts here/)
  expect(screen.getByText('Your launch plan starts with Support inbox.')).toBeInTheDocument()

  // Deselecting the first pick hands the start to the next one picked.
  await user.click(support)
  expect(screen.getByTestId('order')).toHaveTextContent('help_center')
  expect(help).toHaveAccessibleDescription(/Starts here/)
  expect(screen.getByText('Your launch plan starts with Help center.')).toBeInTheDocument()
})
