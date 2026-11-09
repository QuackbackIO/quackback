// @vitest-environment happy-dom
/**
 * Home header: no teammate facepile. Identified visitors keep a profile
 * avatar; anonymous visitors get neither.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
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

/** The Tailwind z-index utility on an element (`z-10`, `z-[60]`), or null. */
function zIndexOf(el: Element): number | null {
  const match = el.className.match(/(?:^|\s)z-(?:\[(\d+)\]|(\d+))(?:\s|$)/)
  return match ? Number(match[1] ?? match[2]) : null
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

  it('stacks the header row, and the profile card it opens, above the body and footer', () => {
    authState.user = { name: 'Ada Example', email: 'ada@example.com', avatarUrl: null }
    authState.isIdentified = true
    const { container } = renderHome()

    const trigger = screen.getByRole('button', { name: 'User menu' })
    fireEvent.click(trigger)
    const card = screen.getByText('ada@example.com')

    // The header row, body and footer are positioned siblings that each create
    // a stacking context. The card's own z-index only applies inside the header
    // row's context, so it shows above the Home cards only when the header row
    // itself stacks above every sibling painted after it.
    const panel = container.firstElementChild as HTMLElement
    const rows = Array.from(panel.children) as HTMLElement[]
    const header = rows.find((row) => row.contains(trigger))!
    expect(header.contains(card)).toBe(true)
    const later = rows.slice(rows.indexOf(header) + 1).filter((row) => zIndexOf(row) !== null)
    expect(later.some((row) => row.textContent?.includes('home'))).toBe(true)
    for (const row of later) {
      expect(zIndexOf(header)).toBeGreaterThan(zIndexOf(row)!)
    }
  })

  it('has no profile avatar and no teammate cluster for an anonymous visitor', () => {
    renderHome()

    expect(screen.queryByRole('button', { name: 'User menu' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Close feedback widget' })).toBeTruthy()
    expect(document.querySelectorAll('.size-7').length).toBe(0)
  })
})
