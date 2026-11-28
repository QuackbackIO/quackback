import { describe, it, expect } from 'vitest'
import {
  ticketDueBounds,
  ticketDueProblem,
  endOfLocalDay,
  toLocalDateInputValue,
  isTicketDueFilter,
  ticketDueState,
  dueAlertMarkersOnSet,
  TICKET_DUE_FILTERS,
  TICKET_DUE_PAST_GRACE_MS,
  TICKET_DUE_SOON_WINDOW_MS,
} from '../ticket-due'
import { ticketDueAtWireSchema, createMyTicketSchema } from '../schemas/tickets'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const NOW = new Date('2026-10-14T12:00:00.000Z')
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs)

describe('ticketDueBounds', () => {
  it('gives a customer 15 minutes of grace back and 731 days ahead', () => {
    const { min, max } = ticketDueBounds('customer', NOW)
    expect(NOW.getTime() - min.getTime()).toBe(TICKET_DUE_PAST_GRACE_MS)
    expect(TICKET_DUE_PAST_GRACE_MS).toBe(15 * MINUTE)
    expect(max.getTime() - NOW.getTime()).toBe(731 * DAY)
  })

  it('gives a teammate a year back and five years ahead', () => {
    const { min, max } = ticketDueBounds('team', NOW)
    expect(NOW.getTime() - min.getTime()).toBe(365 * DAY)
    expect(max.getTime() - NOW.getTime()).toBe(5 * 365 * DAY)
  })
})

describe('ticketDueProblem', () => {
  it('accepts the customer window edges, inclusive', () => {
    expect(ticketDueProblem(at(0), 'customer', NOW)).toBeNull()
    expect(ticketDueProblem(at(-15 * MINUTE), 'customer', NOW)).toBeNull()
    expect(ticketDueProblem(at(731 * DAY), 'customer', NOW)).toBeNull()
  })

  it('rejects a customer date just past the grace as past, and just beyond two years as too far', () => {
    expect(ticketDueProblem(at(-15 * MINUTE - 1), 'customer', NOW)).toBe('past')
    expect(ticketDueProblem(at(-DAY), 'customer', NOW)).toBe('past')
    expect(ticketDueProblem(at(731 * DAY + 1), 'customer', NOW)).toBe('too_far')
  })

  it('accepts the team window edges, inclusive', () => {
    expect(ticketDueProblem(at(-365 * DAY), 'team', NOW)).toBeNull()
    expect(ticketDueProblem(at(-DAY), 'team', NOW)).toBeNull()
    expect(ticketDueProblem(at(5 * 365 * DAY), 'team', NOW)).toBeNull()
  })

  it('rejects a team date beyond either edge as too old or too far', () => {
    expect(ticketDueProblem(at(-365 * DAY - 1), 'team', NOW)).toBe('too_old')
    expect(ticketDueProblem(at(5 * 365 * DAY + 1), 'team', NOW)).toBe('too_far')
  })

  it('reports a missing or invalid date as invalid for either audience', () => {
    expect(ticketDueProblem(null, 'customer', NOW)).toBe('invalid')
    expect(ticketDueProblem(new Date('nope'), 'team', NOW)).toBe('invalid')
  })
})

describe('endOfLocalDay', () => {
  it('returns 23:59 local time on the picked calendar day', () => {
    const d = endOfLocalDay('2026-10-21')!
    expect(d).toBeInstanceOf(Date)
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 21])
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([
      23, 59, 0, 0,
    ])
  })

  it('handles a leap day', () => {
    expect(endOfLocalDay('2028-02-29')?.getDate()).toBe(29)
  })

  it('returns null for an impossible date instead of rolling it over', () => {
    expect(endOfLocalDay('2026-02-30')).toBeNull()
    expect(endOfLocalDay('2026-02-29')).toBeNull()
    expect(endOfLocalDay('2026-13-01')).toBeNull()
    expect(endOfLocalDay('2026-00-10')).toBeNull()
  })

  it('returns null for junk and non date-only strings', () => {
    expect(endOfLocalDay('')).toBeNull()
    expect(endOfLocalDay('tomorrow')).toBeNull()
    expect(endOfLocalDay('2026-1-5')).toBeNull()
    expect(endOfLocalDay('2026-10-21T10:00:00Z')).toBeNull()
    expect(endOfLocalDay('2026-10-21junk')).toBeNull()
  })
})

describe('toLocalDateInputValue', () => {
  it('formats the local calendar day with zero padding', () => {
    expect(toLocalDateInputValue(new Date(2026, 0, 5, 9, 30))).toBe('2026-01-05')
    expect(toLocalDateInputValue(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
  })

  it('round-trips through endOfLocalDay', () => {
    expect(toLocalDateInputValue(endOfLocalDay('2026-03-08')!)).toBe('2026-03-08')
  })
})

describe('isTicketDueFilter', () => {
  it('accepts exactly the declared filters', () => {
    for (const f of TICKET_DUE_FILTERS) expect(isTicketDueFilter(f)).toBe(true)
    expect(isTicketDueFilter('late')).toBe(false)
    expect(isTicketDueFilter('')).toBe(false)
    expect(isTicketDueFilter(null)).toBe(false)
    expect(isTicketDueFilter(1)).toBe(false)
  })
})

describe('ticketDueState', () => {
  it('is null with no due date, an invalid one, or a closed ticket', () => {
    expect(ticketDueState(null, false, NOW)).toBeNull()
    expect(ticketDueState(undefined, false, NOW)).toBeNull()
    expect(ticketDueState('not a date', false, NOW)).toBeNull()
    expect(ticketDueState(at(-DAY), true, NOW)).toBeNull()
    expect(ticketDueState(at(DAY / 2), true, NOW)).toBeNull()
  })

  it('is overdue at exactly now and after', () => {
    expect(ticketDueState(at(0), false, NOW)).toBe('overdue')
    expect(ticketDueState(at(-1), false, NOW)).toBe('overdue')
  })

  it('is due soon from just after now up to the window edge, inclusive', () => {
    expect(ticketDueState(at(1), false, NOW)).toBe('due_soon')
    expect(ticketDueState(at(TICKET_DUE_SOON_WINDOW_MS), false, NOW)).toBe('due_soon')
  })

  it('is scheduled past the window edge', () => {
    expect(ticketDueState(at(TICKET_DUE_SOON_WINDOW_MS + 1), false, NOW)).toBe('scheduled')
  })

  it('accepts an ISO string as well as a Date', () => {
    expect(ticketDueState(at(-1).toISOString(), false, NOW)).toBe('overdue')
    expect(ticketDueState(at(2 * DAY).toISOString(), false, NOW)).toBe('scheduled')
  })
})

describe('dueAlertMarkersOnSet', () => {
  const markers = (dueAt: Date | null, actorIsAssignee = false) =>
    dueAlertMarkersOnSet({ dueAt, now: NOW, actorIsAssignee })

  it('clears both markers when the date is cleared', () => {
    expect(markers(null)).toEqual({ dueSoonNotifiedFor: null, overdueNotifiedFor: null })
    expect(markers(null, true)).toEqual({ dueSoonNotifiedFor: null, overdueNotifiedFor: null })
  })

  it('suppresses both alerts for a date already past (or exactly now)', () => {
    for (const due of [at(-DAY), at(0)]) {
      expect(markers(due)).toEqual({ dueSoonNotifiedFor: due, overdueNotifiedFor: due })
      expect(markers(due, true)).toEqual({ dueSoonNotifiedFor: due, overdueNotifiedFor: due })
    }
  })

  it('skips only the due-soon alert when the assignee sets a near-term date', () => {
    for (const due of [at(1), at(TICKET_DUE_SOON_WINDOW_MS)]) {
      expect(markers(due, true)).toEqual({ dueSoonNotifiedFor: due, overdueNotifiedFor: null })
    }
  })

  it('arms both alerts for anyone else setting a near-term date', () => {
    expect(markers(at(MINUTE))).toEqual({ dueSoonNotifiedFor: null, overdueNotifiedFor: null })
  })

  it('arms both alerts for a date beyond the soon window, even from the assignee', () => {
    const due = at(TICKET_DUE_SOON_WINDOW_MS + 1)
    expect(markers(due, true)).toEqual({ dueSoonNotifiedFor: null, overdueNotifiedFor: null })
    expect(markers(due)).toEqual({ dueSoonNotifiedFor: null, overdueNotifiedFor: null })
  })
})

describe('ticketDueAtWireSchema', () => {
  it('accepts an instant with Z or an explicit offset', () => {
    for (const v of [
      '2026-11-03T17:00:00Z',
      '2026-11-03T17:00:00.000Z',
      '2026-11-03T18:00:00+01:00',
      '2026-11-03T09:00:00-08:00',
    ]) {
      expect(ticketDueAtWireSchema.safeParse(v).success).toBe(true)
    }
  })

  it('rejects a date-only value, a zone-less time, and junk', () => {
    for (const v of ['2026-11-03', '2026-11-03T17:00:00', 'tomorrow', '', 1_700_000_000, null]) {
      expect(ticketDueAtWireSchema.safeParse(v).success).toBe(false)
    }
  })

  it('is optional on the customer create schema', () => {
    expect(createMyTicketSchema.safeParse({ title: 'Hi' }).success).toBe(true)
    expect(
      createMyTicketSchema.safeParse({ title: 'Hi', dueAt: '2026-11-03T23:59:00-08:00' }).success
    ).toBe(true)
    expect(createMyTicketSchema.safeParse({ title: 'Hi', dueAt: '2026-11-03' }).success).toBe(false)
  })
})
