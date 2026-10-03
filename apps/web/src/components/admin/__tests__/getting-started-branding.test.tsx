// @vitest-environment happy-dom
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, expect, it, vi } from 'vitest'
import { GettingStartedCard } from '../getting-started-card'
import type { LaunchStatus } from '@/lib/shared/launch-checklist'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

afterEach(cleanup)

const completed: LaunchStatus = {
  hasBoards: true,
  hasPublicBoard: true,
  publicBoardLinkCopiedAt: '2026-01-01T00:00:00.000Z',
  hasInternalBoard: false,
  memberCount: 2,
  hasBranding: true,
  hasWidgetInstalled: true,
  hasWidgetEnabled: true,
  hasMessengerEnabled: true,
  hasAgentAnswering: true,
  hasHelpArticle: true,
  hasPublishedChangelog: true,
  hasStatusComponent: true,
  hasIntegration: true,
  hasFirstWin: true,
  goals: ['product_feedback'],
}

function mount(notice?: ReactNode) {
  render(
    <IntlProvider locale="en">
      <GettingStartedCard
        status={completed}
        pending={false}
        onSkip={() => {
          throw new Error('A completed task cannot be skipped')
        }}
        onCreateBoard={() => {
          throw new Error('A completed board cannot be created')
        }}
        brandingNotice={notice}
      />
    </IntlProvider>
  )
}

it('keeps the automatic logo notice and Undo in the live portal tile after the plan is complete', () => {
  const undo = vi.fn()
  mount(
    <span>
      Logo from example.com · <button onClick={undo}>Undo</button>
    </span>
  )
  expect(screen.getByRole('heading', { name: 'Portal is live' })).toBeVisible()
  expect(screen.getByText('Logo from example.com ·')).toBeVisible()
  const tile = screen.getByRole('heading', { name: 'Portal is live' }).closest('li')!
  expect(tile).toContainElement(screen.getByRole('button', { name: 'Undo' }))
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(undo).toHaveBeenCalledTimes(1)
})

it('keeps a completed launch plan quiet when it has no automatic change to review', () => {
  mount()
  expect(screen.queryByRole('heading', { name: 'Your launch plan' })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Portal is live' })).toBeNull()
})
