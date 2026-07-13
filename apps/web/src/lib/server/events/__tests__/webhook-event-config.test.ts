/**
 * Guard test: every event in `EVENT_TYPES` MUST have a matching entry in
 * `WEBHOOK_EVENT_CONFIG` (otherwise admins can't subscribe to it from the UI),
 * and every category referenced must be declared in `WEBHOOK_EVENT_CATEGORIES`.
 *
 * Without this, a new event type can be added server-side and silently go dark
 * for every webhook subscriber.
 */
import { describe, it, expect } from 'vitest'
import { EVENT_TYPES } from '../types'
import { WEBHOOK_EVENT_CONFIG, WEBHOOK_EVENT_CATEGORIES } from '../integrations/webhook/constants'

describe('WEBHOOK_EVENT_CONFIG coverage', () => {
  it('has exactly one entry per EVENT_TYPES member', () => {
    const configIds = WEBHOOK_EVENT_CONFIG.map((e) => e.id).sort()
    const eventIds = [...EVENT_TYPES].sort()
    expect(configIds).toEqual(eventIds)
  })

  it('has no duplicate event ids', () => {
    const ids = WEBHOOK_EVENT_CONFIG.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses only declared categories', () => {
    const allowed = new Set(WEBHOOK_EVENT_CATEGORIES.map((c) => c.id))
    for (const entry of WEBHOOK_EVENT_CONFIG) {
      expect(
        allowed.has(entry.category),
        `unknown category for ${entry.id}: ${entry.category}`
      ).toBe(true)
    }
  })

  it('every declared category has at least one event', () => {
    for (const category of WEBHOOK_EVENT_CATEGORIES) {
      const count = WEBHOOK_EVENT_CONFIG.filter((e) => e.category === category.id).length
      expect(count, `category ${category.id} has no events`).toBeGreaterThan(0)
    }
  })
})
