// @vitest-environment happy-dom
/**
 * Escape inside the widget: the first press inside a field only leaves the
 * field, and the next one closes the widget.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

const auth = vi.hoisted(() => ({ closeWidget: vi.fn() }))

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    user: null,
    isIdentified: false,
    hmacRequired: false,
    canPortalHandoff: true,
    closeWidget: auth.closeWidget,
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
vi.mock('@/components/shared/user-stats', () => ({ UserStatsBar: () => null }))

import { WidgetShell } from '../widget-shell'

function renderWithField() {
  render(
    <IntlProvider locale="en">
      <WidgetShell
        orgSlug="acme"
        activeTab="messages"
        onTabChange={() => {}}
        enabledTabs={{ messages: true }}
      >
        <textarea aria-label="Message" />
      </WidgetShell>
    </IntlProvider>
  )
  const field = screen.getByLabelText('Message')
  field.focus()
  return field
}

async function pressEscape(target: HTMLElement) {
  await act(async () => {
    fireEvent.keyDown(target, { key: 'Escape' })
    await Promise.resolve()
  })
}

beforeEach(() => {
  auth.closeWidget.mockReset()
})
afterEach(cleanup)

describe('WidgetShell Escape', () => {
  it('the first press in a field only leaves the field, the next closes', async () => {
    const field = renderWithField()
    await pressEscape(field)
    expect(auth.closeWidget).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(field)
    await pressEscape(document.body)
    expect(auth.closeWidget).toHaveBeenCalledTimes(1)
  })

  it('a press another control already handled does not close', async () => {
    const field = renderWithField()
    field.addEventListener('keydown', (event) => event.preventDefault())
    await pressEscape(field)
    expect(auth.closeWidget).not.toHaveBeenCalled()
  })
})
