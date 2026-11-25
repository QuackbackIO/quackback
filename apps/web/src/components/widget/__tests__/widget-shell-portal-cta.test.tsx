// @vitest-environment happy-dom
/**
 * "Go to portal" mints a one-time sign-in link only when the host can receive
 * it now. Otherwise it opens the plain sign-in page, so the button never does
 * nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

const bridge = vi.hoisted(() => ({
  sendToHost: vi.fn(),
  canDeliverUserData: vi.fn(() => true),
}))
const widgetAuth = vi.hoisted(() => ({
  getWidgetAuthHeaders: () => ({}),
  generateOneTimeToken: vi.fn(async () => 'ott_1'),
}))

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    user: { name: 'Ada Example', email: 'ada@example.com', avatarUrl: null },
    isIdentified: true,
    hmacRequired: true,
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
vi.mock('@/lib/client/widget-bridge', () => bridge)
vi.mock('@/lib/client/widget-auth', () => widgetAuth)
vi.mock('@/components/shared/user-stats', () => ({ UserStatsBar: () => null }))

import { WidgetShell } from '../widget-shell'

function clickPortal() {
  render(
    <IntlProvider locale="en">
      <WidgetShell
        orgSlug="acme"
        activeTab="home"
        onTabChange={() => {}}
        enabledTabs={{ feedback: true }}
        portalAccess={{ isPrivate: true, widgetSignIn: true }}
        portalOrigin="https://portal.example"
      >
        home
      </WidgetShell>
    </IntlProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Go to portal' }))
}

describe('WidgetShell portal CTA', () => {
  beforeEach(() => {
    bridge.sendToHost.mockClear()
    widgetAuth.generateOneTimeToken.mockClear()
  })

  it('sends the one-time sign-in link when the host can receive it', async () => {
    bridge.canDeliverUserData.mockReturnValue(true)
    clickPortal()
    await waitFor(() =>
      expect(bridge.sendToHost).toHaveBeenCalledWith({
        type: 'quackback:navigate',
        url: 'https://portal.example/auth/widget-handoff?ott=ott_1',
      })
    )
  })

  it('opens the plain sign-in page, minting nothing, when the host cannot receive it yet', async () => {
    bridge.canDeliverUserData.mockReturnValue(false)
    clickPortal()
    await waitFor(() =>
      expect(bridge.sendToHost).toHaveBeenCalledWith({
        type: 'quackback:navigate',
        url: 'https://portal.example/?auth=signin',
      })
    )
    expect(widgetAuth.generateOneTimeToken).not.toHaveBeenCalled()
  })
})
