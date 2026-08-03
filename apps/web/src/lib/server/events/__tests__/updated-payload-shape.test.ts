/**
 * Phase 6 housekeeping: lock in the `*.updated` payload contract.
 *
 * Every `*.updated` event must carry exactly two data keys: the entity
 * reference and `changedFields: string[]`. No `before` / `previousValues` /
 * `prior` / `oldValues` / `diff` snapshot may leak into the payload — keeping
 * payloads bounded matches the established `ticket.updated` shape and lets
 * integrators rely on the prior webhook (or REST GET) for before-state.
 */
import { describe, it, expect } from 'vitest'
import { getSampleEventPayload } from '../sample-payloads'
import type { EventType } from '../types'

interface UpdatedCase {
  type: EventType
  refKey: 'inbox' | 'team' | 'status' | 'contact' | 'organization'
}

const CASES: UpdatedCase[] = [
  { type: 'inbox.updated', refKey: 'inbox' },
  { type: 'team.updated', refKey: 'team' },
  { type: 'ticket_status.updated', refKey: 'status' },
  { type: 'contact.updated', refKey: 'contact' },
  { type: 'organization.updated', refKey: 'organization' },
]

const FORBIDDEN_KEYS = ['before', 'previous', 'previousValues', 'prior', 'oldValues', 'diff']

describe('*.updated payload shape (Phase 6 housekeeping)', () => {
  it.each(CASES)('$type carries only { $refKey, changedFields }', ({ type, refKey }) => {
    const event = getSampleEventPayload(type)
    const data = event.data as unknown as Record<string, unknown>

    // changedFields is required, non-empty, all strings
    expect(Array.isArray(data.changedFields)).toBe(true)
    const changedFields = data.changedFields as unknown[]
    expect(changedFields.length).toBeGreaterThan(0)
    for (const f of changedFields) expect(typeof f).toBe('string')

    // Entity ref present and shaped like an object with at least an id
    expect(data[refKey]).toBeDefined()
    expect(typeof data[refKey]).toBe('object')
    expect((data[refKey] as { id?: unknown }).id).toBeDefined()

    // Exactly the two expected keys — nothing else
    expect(Object.keys(data).sort()).toEqual([refKey, 'changedFields'].sort())

    // No before/previous-style snapshot keys leaked in
    for (const k of FORBIDDEN_KEYS) {
      expect(data).not.toHaveProperty(k)
    }
  })
})
