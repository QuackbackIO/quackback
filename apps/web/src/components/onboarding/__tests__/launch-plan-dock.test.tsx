// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { LaunchStatus } from '@/lib/shared/launch-checklist'

const replay = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('../product-tour', () => ({ useProductTour: () => ({ start: replay }) }))
import { LaunchPlanPopover } from '../launch-plan-popover'

afterEach(() => {
  cleanup()
  replay.mockClear()
})

const status: LaunchStatus = {
  hasBoards: true,
  hasPublicBoard: true,
  memberCount: 1,
  hasBranding: false,
  goals: ['product_feedback', 'customer_support', 'help_center'],
  features: {
    supportInbox: true,
    helpCenter: true,
    statusPage: false,
    integrations: false,
    assistant: false,
  },
}

it('shows actual launch progress in the sidebar control and preserves keyboard replay', async () => {
  render(
    <IntlProvider locale="en">
      <LaunchPlanPopover status={status} />
    </IntlProvider>
  )
  const control = screen.getByRole('button', { name: /Launch plan/ })
  const progress = within(control).getByRole('progressbar')
  expect(progress).toHaveAttribute('aria-valuenow', '1')
  expect(progress).toHaveAttribute('aria-valuemax', '4')
  expect(control).toHaveTextContent('1/4')
  fireEvent.click(control)
  const replayButton = await screen.findByRole('button', { name: 'Replay the tour' })
  replayButton.focus()
  expect(replayButton).toHaveFocus()
  fireEvent.click(replayButton)
  expect(replay).toHaveBeenCalledTimes(1)
})
