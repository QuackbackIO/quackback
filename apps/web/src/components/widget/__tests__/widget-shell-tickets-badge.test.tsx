// @vitest-environment happy-dom
/**
 * Tab bar badges: the Tickets badge counts tickets whose status changed, so
 * its label names updated tickets rather than unread messages.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    user: null,
    isIdentified: false,
    hmacRequired: false,
    canPortalHandoff: true,
    closeWidget: vi.fn(),
    sessionVersion: 1,
  }),
}))
vi.mock('../use-messenger-unread', () => ({
  useMessengerUnread: () => 3,
  useMessengerUnreadState: () => ({ total: 3, newestReplyId: null }),
  useRefreshSummaryOnUnreadChange: () => {},
}))
vi.mock('../use-changelog-unread', () => ({
  useChangelogUnread: () => ({
    unread: 0,
    newest: null,
    announced: { count: 0, newest: null, more: false },
    ready: true,
    more: false,
    markSeen: vi.fn(),
  }),
}))
vi.mock('../reply-preview', () => ({
  useUnreadReplies: () => ({ ready: true, data: null }),
  useReplyPreviewAnnouncement: () => {},
}))
vi.mock('../use-ticket-stage-badge', () => ({
  useTicketStageBadge: () => ({ unread: 2, hasTickets: true }),
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

describe('WidgetShell tab badges', () => {
  it('labels the Tickets badge as updated tickets and the Messages badge as unread', () => {
    render(
      <IntlProvider locale="en">
        <WidgetShell
          orgSlug="acme"
          activeTab="home"
          onTabChange={() => {}}
          enabledTabs={{ feedback: true, messages: true, tickets: true }}
        >
          home
        </WidgetShell>
      </IntlProvider>
    )

    expect(document.querySelector('[aria-label="2 tickets updated"]')).toBeTruthy()
    expect(document.querySelector('[aria-label="3 unread"]')).toBeTruthy()
    expect(document.querySelector('[aria-label="2 unread"]')).toBeNull()
  })
})
