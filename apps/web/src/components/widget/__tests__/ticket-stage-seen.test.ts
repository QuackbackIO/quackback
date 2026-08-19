// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  countTicketStageChanges,
  getTicketStagesSeen,
  markTicketStagesSeen,
  TICKET_STAGES_SEEN_EVENT,
} from '../ticket-stage-seen'
import { installInMemoryLocalStorage } from '@/test/local-storage'

installInMemoryLocalStorage()

const ticket = (ticketId: string, slot: string | null) => ({
  ticketId,
  stage: { slot },
})

describe('countTicketStageChanges', () => {
  it('treats a missing marker map as nothing unread (first-contact baseline)', () => {
    const tickets = [ticket('tkt_1', 'open'), ticket('tkt_2', 'resolved')]
    expect(countTicketStageChanges(tickets, null)).toBe(0)
  })

  it('counts tickets whose stage moved since the seen marker', () => {
    const seen = { tkt_1: 'open', tkt_2: 'open' }
    const tickets = [ticket('tkt_1', 'open'), ticket('tkt_2', 'in_progress')]
    expect(countTicketStageChanges(tickets, seen)).toBe(1)
  })

  it('counts a move to a null (internal-only) stage as a change', () => {
    const seen = { tkt_1: 'open' }
    expect(countTicketStageChanges([ticket('tkt_1', null)], seen)).toBe(1)
  })

  it('ignores tickets absent from the marker map (filed after baseline)', () => {
    const seen = { tkt_1: 'open' }
    const tickets = [ticket('tkt_1', 'open'), ticket('tkt_2', 'open')]
    expect(countTicketStageChanges(tickets, seen)).toBe(0)
  })

  it('returns 0 when every stage matches its marker', () => {
    const seen = { tkt_1: 'resolved', tkt_2: null }
    const tickets = [ticket('tkt_1', 'resolved'), ticket('tkt_2', null)]
    expect(countTicketStageChanges(tickets, seen)).toBe(0)
  })
})

describe('stage marker storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('round-trips the marker map through window.localStorage', () => {
    expect(getTicketStagesSeen()).toBeNull()
    markTicketStagesSeen([ticket('tkt_1', 'open'), ticket('tkt_2', null)])
    expect(getTicketStagesSeen()).toEqual({ tkt_1: 'open', tkt_2: null })
  })

  it('merges into the existing map instead of dropping earlier tickets', () => {
    markTicketStagesSeen([ticket('tkt_1', 'open')])
    markTicketStagesSeen([ticket('tkt_2', 'resolved')])
    expect(getTicketStagesSeen()).toEqual({ tkt_1: 'open', tkt_2: 'resolved' })
  })

  it('advances a ticket marker to its latest stage', () => {
    markTicketStagesSeen([ticket('tkt_1', 'open')])
    markTicketStagesSeen([ticket('tkt_1', 'resolved')])
    expect(getTicketStagesSeen()).toEqual({ tkt_1: 'resolved' })
  })

  it('dispatches the seen event so open listeners re-read the map', () => {
    const listener = vi.fn()
    window.addEventListener(TICKET_STAGES_SEEN_EVENT, listener)
    markTicketStagesSeen([ticket('tkt_1', 'open')])
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(TICKET_STAGES_SEEN_EVENT, listener)
  })

  it('ignores a corrupted stored value instead of throwing', () => {
    window.localStorage.setItem('quackback:ticket-stages-seen', '{not json')
    expect(getTicketStagesSeen()).toBeNull()
  })
})
