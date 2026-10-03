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

const open: LaunchStatus = {
  ...completed,
  hasBoards: false,
  hasPublicBoard: false,
  publicBoardLinkCopiedAt: null,
}

function mount(status: LaunchStatus, notice?: ReactNode) {
  return render(
    <IntlProvider locale="en">
      <GettingStartedCard
        status={status}
        pending={false}
        onSkip={() => {
          throw new Error('Skipping is not part of this test')
        }}
        onCreateBoard={() => {
          throw new Error('A completed board cannot be created')
        }}
        brandingNotice={notice}
      />
    </IntlProvider>
  )
}

it('shows the automatic logo notice and Undo in the live portal tile of an active plan', () => {
  const undo = vi.fn()
  mount(
    open,
    <span>
      Logo from example.com · <button onClick={undo}>Undo</button>
    </span>
  )
  const tile = screen.getByRole('heading', { name: 'Portal is live' }).closest('li')!
  expect(tile).toContainElement(screen.getByRole('button', { name: 'Undo' }))
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(undo).toHaveBeenCalledTimes(1)
})

it('never brings a resolved launch plan back for a branding notice', () => {
  const view = mount(
    completed,
    <span>
      Logo from example.com · <button>Undo</button>
    </span>
  )
  expect(view.container).toBeEmptyDOMElement()
  expect(screen.queryByText(/Logo from example.com/)).toBeNull()
})
