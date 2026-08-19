/**
 * DB-free unit tests for the unified inbox item model's pure helpers
 * (UNIFIED-INBOX-SPEC.md §2.1). No server/db imports — these run against
 * fabricated TypeID strings only.
 */
import { describe, expect, it } from 'vitest'
import { generateId } from '@quackback/ids'
import {
  facetToConversationStatus,
  facetToTicketStatusCategory,
  inboxItemRefFromId,
  isInboxTriageFacet,
  INBOX_TRIAGE_FACETS,
} from '../items'

describe('facetToConversationStatus', () => {
  it('maps open/waiting/closed to their conversation status', () => {
    expect(facetToConversationStatus('open')).toBe('open')
    expect(facetToConversationStatus('waiting')).toBe('snoozed')
    expect(facetToConversationStatus('closed')).toBe('closed')
  })

  it('maps all to undefined (no status filter)', () => {
    expect(facetToConversationStatus('all')).toBeUndefined()
  })
})

describe('facetToTicketStatusCategory', () => {
  it('maps open/waiting/closed to their ticket status category', () => {
    expect(facetToTicketStatusCategory('open')).toBe('open')
    expect(facetToTicketStatusCategory('waiting')).toBe('pending')
    expect(facetToTicketStatusCategory('closed')).toBe('closed')
  })

  it('maps all to undefined (no category filter)', () => {
    expect(facetToTicketStatusCategory('all')).toBeUndefined()
  })
})

describe('isInboxTriageFacet', () => {
  it('accepts every declared facet', () => {
    for (const facet of INBOX_TRIAGE_FACETS) {
      expect(isInboxTriageFacet(facet)).toBe(true)
    }
  })

  it('rejects unknown strings and non-strings', () => {
    expect(isInboxTriageFacet('snoozed')).toBe(false)
    expect(isInboxTriageFacet('')).toBe(false)
    expect(isInboxTriageFacet(undefined)).toBe(false)
    expect(isInboxTriageFacet(42)).toBe(false)
  })
})

describe('inboxItemRefFromId', () => {
  it('discriminates a conversation TypeID', () => {
    const id = generateId('conversation')
    expect(inboxItemRefFromId(id)).toEqual({ kind: 'conversation', id })
  })

  it('discriminates a ticket TypeID', () => {
    const id = generateId('ticket')
    expect(inboxItemRefFromId(id)).toEqual({ kind: 'ticket', id })
  })

  it('returns null for a foreign-prefix TypeID', () => {
    const id = generateId('post')
    expect(inboxItemRefFromId(id)).toBeNull()
  })

  it('returns null for garbage input', () => {
    expect(inboxItemRefFromId('')).toBeNull()
    expect(inboxItemRefFromId('not-a-typeid')).toBeNull()
    expect(inboxItemRefFromId('ticket_')).toBeNull()
  })
})
