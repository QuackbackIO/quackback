/**
 * Coverage guard: every EVENT_TYPE must have a canonical sample payload, and
 * each sample's envelope `type` must match its key. Keeps the test-fire +
 * preview UI honest as new event ids are added.
 */
import { describe, it, expect } from 'vitest'
import { EVENT_TYPES } from '../types'
import {
  getSampleEventPayload,
  getAllSampleEventPayloads,
  SAMPLE_EVENT_ID_PREFIX,
} from '../sample-payloads'

describe('sample event payloads', () => {
  it('has a sample for every EVENT_TYPE', () => {
    for (const type of EVENT_TYPES) {
      const sample = getSampleEventPayload(type)
      expect(sample, `missing sample for ${type}`).toBeDefined()
      expect(sample.type).toBe(type)
    }
  })

  it('returns a record keyed by every event type', () => {
    const all = getAllSampleEventPayloads()
    expect(Object.keys(all).sort()).toEqual([...EVENT_TYPES].sort())
  })

  it('uses the documented sample-id prefix on every envelope', () => {
    for (const type of EVENT_TYPES) {
      const sample = getSampleEventPayload(type)
      expect(sample.id.startsWith(SAMPLE_EVENT_ID_PREFIX), `bad id prefix for ${type}`).toBe(true)
    }
  })

  it('marks the actor as service so production logic can short-circuit', () => {
    for (const type of EVENT_TYPES) {
      expect(getSampleEventPayload(type).actor.type).toBe('service')
    }
  })
})
