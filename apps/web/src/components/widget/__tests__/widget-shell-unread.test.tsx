// @vitest-environment happy-dom
/**
 * What the shell tells the host about unread items: the launcher badge total
 * with its messages, changelog and tickets parts, and the reply preview and
 * tab title settings, which apply only while the Messages tab shows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

const h = vi.hoisted(() => ({
  sendToHost: vi.fn(),
  useMessengerUnread: vi.fn((_enabled: boolean, _opts?: { background?: boolean }) => 3),
  useUnreadReplies: vi.fn((_enabled: boolean, _unread: number) => ({ ready: true, data: null })),
  useReplyPreviewAnnouncement: vi.fn(),
}))

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    user: null,
    isIdentified: false,
    hmacRequired: false,
    canPortalHandoff: true,
    closeWidget: vi.fn(),
    sessionVersion: 4,
  }),
}))
vi.mock('../use-messenger-unread', () => ({ useMessengerUnread: h.useMessengerUnread }))
vi.mock('../reply-preview', () => ({
  useUnreadReplies: h.useUnreadReplies,
  useReplyPreviewAnnouncement: h.useReplyPreviewAnnouncement,
}))
vi.mock('../use-changelog-unread', () => ({
  useChangelogUnread: () => ({ unread: 2, newest: null, ready: true, more: false }),
}))
vi.mock('../use-ticket-stage-badge', () => ({
  useTicketStageBadge: () => ({ unread: 1, hasTickets: true }),
}))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: h.sendToHost }))
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => ({}),
  generateOneTimeToken: vi.fn(),
}))
vi.mock('@/components/shared/user-stats', () => ({ UserStatsBar: () => null }))

import { WidgetShell } from '../widget-shell'

function renderShell(props: Partial<Parameters<typeof WidgetShell>[0]> = {}) {
  return render(
    <IntlProvider locale="en">
      <WidgetShell
        orgSlug="acme"
        activeTab="home"
        onTabChange={() => {}}
        enabledTabs={{ feedback: true, messages: true, changelog: true, tickets: true }}
        {...props}
      >
        home
      </WidgetShell>
    </IntlProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('WidgetShell unread for the host', () => {
  it('sends the badge total with its parts', () => {
    renderShell()
    expect(h.sendToHost).toHaveBeenCalledWith({
      type: 'quackback:unread',
      count: 6,
      messages: 3,
      changelog: 2,
      tickets: 1,
    })
  })

  it('reads the replies for a preview, and polls in the background only for the tab title', () => {
    renderShell({ replyAlerts: 'preview', titleAlerts: false })
    expect(h.useMessengerUnread).toHaveBeenLastCalledWith(true, { background: false })
    expect(h.useUnreadReplies).toHaveBeenLastCalledWith(true, 3)
    expect(h.useReplyPreviewAnnouncement).toHaveBeenLastCalledWith(
      { replyAlerts: 'preview', titleAlerts: false },
      { ready: true, data: null, session: 4 }
    )
    renderShell({ replyAlerts: 'badge', titleAlerts: true })
    expect(h.useMessengerUnread).toHaveBeenLastCalledWith(true, { background: true })
    expect(h.useUnreadReplies).toHaveBeenLastCalledWith(true, 3)
  })

  it('reads no replies with the badge only and no tab title', () => {
    renderShell({ replyAlerts: 'badge', titleAlerts: false })
    expect(h.useUnreadReplies).toHaveBeenLastCalledWith(false, 3)
  })

  it('sends neither while the Messages tab is off', () => {
    renderShell({
      enabledTabs: { feedback: true, changelog: true },
      replyAlerts: 'full',
      titleAlerts: true,
    })
    expect(h.useUnreadReplies).toHaveBeenLastCalledWith(false, 3)
    expect(h.useReplyPreviewAnnouncement).toHaveBeenLastCalledWith(
      { replyAlerts: 'badge', titleAlerts: false },
      expect.anything()
    )
  })
})
