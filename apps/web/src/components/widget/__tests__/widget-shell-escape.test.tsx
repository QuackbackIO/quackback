// @vitest-environment happy-dom
/**
 * Escape inside the widget. On a customer's site the first press inside a
 * field only leaves the field. In a test frame the host page is the app's own
 * Try Messenger sheet, so one press asks it to close.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

const auth = vi.hoisted(() => ({ testSession: false, closeWidget: vi.fn() }))

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({
    user: null,
    isIdentified: false,
    hmacRequired: false,
    canPortalHandoff: true,
    closeWidget: auth.closeWidget,
    sessionVersion: 1,
    testSession: auth.testSession,
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
  auth.testSession = false
})
afterEach(cleanup)

describe('WidgetShell Escape', () => {
  it('on a customer site, the first press in a field only leaves the field', async () => {
    const field = renderWithField()
    await pressEscape(field)
    expect(auth.closeWidget).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(field)
  })

  it('in a test frame, one press in a field asks the host to close', async () => {
    auth.testSession = true
    const field = renderWithField()
    await pressEscape(field)
    expect(auth.closeWidget).toHaveBeenCalledTimes(1)
  })

  it('in a test frame, a press another control already handled does not close', async () => {
    auth.testSession = true
    const field = renderWithField()
    field.addEventListener('keydown', (event) => event.preventDefault())
    await pressEscape(field)
    expect(auth.closeWidget).not.toHaveBeenCalled()
  })
})
