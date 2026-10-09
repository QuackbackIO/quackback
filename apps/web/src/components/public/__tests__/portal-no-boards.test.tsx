// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { resolvePortalNavItems } from '../portal-header-nav'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

import { PortalNoBoards } from '../portal-no-boards'

afterEach(cleanup)

const gates = {
  feedback: true,
  roadmap: true,
  changelog: false,
  help: false,
  support: false,
  status: false,
}

function renderEmpty(items: ReturnType<typeof resolvePortalNavItems>) {
  return render(
    <IntlProvider locale="en">
      <PortalNoBoards orgName="Acme" items={items} />
    </IntlProvider>
  )
}

it('points visitors of a workspace without a board to the pages that are live', () => {
  renderEmpty(resolvePortalNavItems({ ...gates, help: true, status: true }))
  expect(screen.queryByText('Coming Soon')).toBeNull()
  expect(screen.getByRole('link', { name: 'Help Center' })).toHaveAttribute('href', '/hc')
  expect(screen.getByRole('link', { name: 'Status' })).toHaveAttribute('href', '/status')
  // Feedback and Roadmap lead back to this same empty board.
  expect(screen.queryByRole('link', { name: 'Feedback' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Roadmap' })).toBeNull()
})

it('keeps the coming soon state when the board is the only page', () => {
  renderEmpty(resolvePortalNavItems(gates))
  expect(screen.getByText('Coming Soon')).toBeInTheDocument()
  expect(screen.queryAllByRole('link')).toHaveLength(0)
})
