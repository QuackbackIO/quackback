/**
 * Differential-coverage tests for widget/ticket-scope — visible categories,
 * allowed inbox derivation, list scope/filters, and the assert guard.
 */
import { describe, it, expect } from 'vitest'
import {
  visibleWidgetSupportCategories,
  allowedWidgetSupportInboxIds,
  widgetTicketListScope,
  widgetTicketListFilters,
  assertTicketMatchesWidgetContext,
} from '../ticket-scope'

const ctx = (over: Record<string, unknown> = {}) =>
  ({
    profileId: 'wp_1',
    supportConfig: {
      categories: [
        { inboxId: 'inbox_1', visible: true },
        { inboxId: 'inbox_2', visible: false },
        { inboxId: 'inbox_1', visible: true },
      ],
      ticketListScope: 'same_profile_allowed_inboxes',
    },
    ...over,
  }) as never

describe('ticket-scope helpers', () => {
  it('filters hidden categories and dedupes inbox ids', () => {
    expect(visibleWidgetSupportCategories(ctx())).toHaveLength(2)
    expect(allowedWidgetSupportInboxIds(ctx())).toEqual(['inbox_1'])
    expect(visibleWidgetSupportCategories(ctx({ supportConfig: {} }))).toEqual([])
  })
  it('defaults the list scope to requester_owned', () => {
    expect(widgetTicketListScope(ctx({ supportConfig: {} }))).toBe('requester_owned')
  })
  it('list filters: empty for no profile / requester_owned, scoped otherwise', () => {
    expect(widgetTicketListFilters(ctx({ profileId: null }))).toEqual({})
    expect(
      widgetTicketListFilters(ctx({ supportConfig: { ticketListScope: 'requester_owned' } }))
    ).toEqual({})
    expect(widgetTicketListFilters(ctx())).toMatchObject({
      sourceWidgetProfileId: 'wp_1',
      allowedInboxIds: ['inbox_1'],
    })
  })
})

describe('assertTicketMatchesWidgetContext', () => {
  const ticket = (over: Record<string, unknown> = {}) =>
    ({ id: 't1', sourceWidgetProfileId: 'wp_1', inboxId: 'inbox_1', ...over }) as never
  it('passes for no-profile and requester_owned scopes', () => {
    expect(() => assertTicketMatchesWidgetContext(ticket(), ctx({ profileId: null }))).not.toThrow()
    expect(() =>
      assertTicketMatchesWidgetContext(
        ticket(),
        ctx({ supportConfig: { ticketListScope: 'requester_owned' } })
      )
    ).not.toThrow()
  })
  it('throws when the ticket is from a different profile', () => {
    expect(() =>
      assertTicketMatchesWidgetContext(ticket({ sourceWidgetProfileId: 'other' }), ctx())
    ).toThrow('not found')
  })
  it('throws when the ticket inbox is outside the allowed set', () => {
    expect(() => assertTicketMatchesWidgetContext(ticket({ inboxId: 'inbox_9' }), ctx())).toThrow(
      'not found'
    )
  })
  it('passes for a matching profile + allowed inbox', () => {
    expect(() => assertTicketMatchesWidgetContext(ticket(), ctx())).not.toThrow()
  })
})
