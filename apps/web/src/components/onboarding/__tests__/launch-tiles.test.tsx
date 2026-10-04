// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { GettingStartedCard } from '@/components/admin/getting-started-card'
import en from '@/locales/en.json'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))
afterEach(cleanup)

it('shows three tiles drawn from Support and Help center with real destinations', () => {
  const { container } = render(
    <IntlProvider locale="en" messages={en}>
      <GettingStartedCard
        status={{
          hasBoards: false,
          memberCount: 1,
          hasBranding: false,
          goals: ['customer_support', 'help_center'],
          features: {
            supportInbox: true,
            helpCenter: true,
            statusPage: false,
            integrations: true,
            assistant: false,
          },
        }}
        pending={false}
        onSkip={vi.fn()}
        onCreateBoard={vi.fn()}
      />
    </IntlProvider>
  )
  expect(container.querySelectorAll('li')).toHaveLength(3)
  expect(screen.getByText('Portal is live')).toBeVisible()
  expect(screen.getByText('Connect Messenger')).toBeVisible()
  expect(screen.getByText('Write your first article')).toBeVisible()
  expect(container.querySelector('a[href="/admin/help-center"]')).not.toBeNull()
  // Connect Messenger opens the install sheet in place rather than navigating.
  expect(container.querySelector('a[href="/admin/settings/widget/install"]')).toBeNull()
  const opened = vi.fn()
  window.addEventListener('quackback:open-going-live', (event) =>
    opened((event as CustomEvent).detail)
  )
  const messengerTile = screen.getByText('Connect Messenger').closest('li')!
  fireEvent.click(within(messengerTile).getByRole('button', { name: 'Start' }))
  expect(opened).toHaveBeenCalledWith('install-messenger')
})

it('fills the next tile with shared work when a single goal has one prerequisite', () => {
  const { container } = render(
    <IntlProvider locale="en" messages={en}>
      <GettingStartedCard
        status={{
          hasBoards: false,
          memberCount: 1,
          hasBranding: false,
          goals: ['status_page'],
          features: {
            supportInbox: false,
            helpCenter: false,
            statusPage: true,
            integrations: true,
            assistant: false,
          },
        }}
        pending={false}
        onSkip={vi.fn()}
        onCreateBoard={vi.fn()}
      />
    </IntlProvider>
  )
  expect(container.querySelectorAll('li')).toHaveLength(3)
  expect(screen.getByText('Add a service')).toBeVisible()
  expect(screen.getByText('Invite a teammate')).toBeVisible()
})
