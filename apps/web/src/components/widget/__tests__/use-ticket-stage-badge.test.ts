import { describe, it, expect, vi } from 'vitest'

vi.mock('../widget-auth-provider', () => ({ useWidgetAuth: vi.fn() }))
vi.mock('@/lib/client/widget-auth', () => ({ getWidgetAuthHeaders: () => ({}) }))
vi.mock('@/lib/server/functions/tickets', () => ({ getMyTicketsFn: vi.fn() }))

import { resolveHasTickets } from '../use-ticket-stage-badge'

// The Tickets tab is hidden when this visitor has none, and the route reroutes
// off a tab that left the bar — so a provisional "none" must never be reported
// while the real answer is still on its way (see the PR #459 review).
describe('resolveHasTickets', () => {
  const known = { enabled: true, identityResolved: true, isIdentified: true, isError: false }

  it('is unknown until the SDK/portal has said who the visitor is', () => {
    expect(
      resolveHasTickets({
        enabled: true,
        identityResolved: false,
        isIdentified: false,
        data: undefined,
        isError: false,
      })
    ).toBeNull()
  })

  it('is unknown while an identified visitor’s list is loading (incl. after a re-key)', () => {
    expect(resolveHasTickets({ ...known, data: undefined })).toBeNull()
  })

  it('settles once the list arrives', () => {
    expect(resolveHasTickets({ ...known, data: { tickets: [] } })).toBe(false)
    expect(resolveHasTickets({ ...known, data: { tickets: [{}] } })).toBe(true)
  })

  it('treats a resolved anonymous visitor as a definite none', () => {
    expect(resolveHasTickets({ ...known, isIdentified: false, data: undefined })).toBe(false)
  })

  it('settles as none when the load fails (hide rather than show empty)', () => {
    expect(resolveHasTickets({ ...known, data: undefined, isError: true })).toBe(false)
  })

  it('is a definite none when the admin has the Tickets tab off', () => {
    expect(
      resolveHasTickets({
        enabled: false,
        identityResolved: false,
        isIdentified: false,
        data: undefined,
        isError: false,
      })
    ).toBe(false)
  })
})
