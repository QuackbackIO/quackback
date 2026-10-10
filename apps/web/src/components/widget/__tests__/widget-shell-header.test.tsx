// @vitest-environment happy-dom
/**
 * Home header: no teammate facepile. Identified visitors keep a profile
 * avatar; anonymous visitors get neither.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

const authState: {
  user: { name: string; email: string; avatarUrl: string | null } | null
  isIdentified: boolean
} = { user: null, isIdentified: false }

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    user: authState.user,
    isIdentified: authState.isIdentified,
    hmacRequired: false,
    canPortalHandoff: true,
    closeWidget: vi.fn(),
    sessionVersion: 1,
  }),
}))
vi.mock('../use-messenger-unread', () => ({ useMessengerUnread: () => 0 }))
vi.mock('../use-changelog-unread', () => ({
  useChangelogUnread: () => ({ unread: 0, markSeen: vi.fn() }),
}))
vi.mock('../use-ticket-stage-badge', () => ({
  useTicketStageBadge: () => ({ unread: 0, hasTickets: false }),
}))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => ({}),
  generateOneTimeToken: vi.fn(),
}))
vi.mock('@/components/shared/user-stats', () => ({
  UserStatsBar: () => null,
}))

import { WidgetShell } from '../widget-shell'

function wrap(ui: ReactNode) {
  return <IntlProvider locale="en">{ui}</IntlProvider>
}

function renderHome() {
  return render(
    wrap(
      <WidgetShell
        orgSlug="acme"
        activeTab="home"
        onTabChange={() => {}}
        enabledTabs={{ feedback: true, messages: true }}
      >
        home
      </WidgetShell>
    )
  )
}

describe('WidgetShell header', () => {
  beforeEach(() => {
    authState.user = null
    authState.isIdentified = false
  })

  it('keeps the identified visitor profile avatar and does not render a teammate cluster', () => {
    authState.user = {
      name: 'Ada Example',
      email: 'ada@example.com',
      avatarUrl: 'https://example.com/ada.png',
    }
    authState.isIdentified = true
    renderHome()

    expect(screen.getByRole('button', { name: 'User menu' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close feedback widget' })).toBeTruthy()
    expect(screen.getByText('AE')).toBeTruthy()
    // The removed Home teammate cluster used overlapping size-7 avatars.
    expect(document.querySelectorAll('.size-7').length).toBe(0)
  })

  it('has no profile avatar and no teammate cluster for an anonymous visitor', () => {
    renderHome()

    expect(screen.queryByRole('button', { name: 'User menu' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Close feedback widget' })).toBeTruthy()
    expect(document.querySelectorAll('.size-7').length).toBe(0)
  })
})
