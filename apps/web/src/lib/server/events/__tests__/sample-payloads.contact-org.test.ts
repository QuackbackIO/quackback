/**
 * Phase 5: ensure CRM event types have well-formed sample payloads so
 * the test-fire endpoint and create/edit dialog preview accordion work
 * for every new event.
 */
import { describe, it, expect } from 'vitest'
import { getSampleEventPayload } from '../sample-payloads'
import type { EventType } from '../types'

const CRM_EVENTS: EventType[] = [
  'contact.created',
  'contact.updated',
  'contact.archived',
  'contact.linked',
  'contact.unlinked',
  'organization.created',
  'organization.updated',
  'organization.archived',
  'organization.unarchived',
]

describe('sample-payloads — CRM events (Phase 5)', () => {
  it.each(CRM_EVENTS)('returns a well-formed envelope for %s', (eventType) => {
    const sample = getSampleEventPayload(eventType)
    expect(sample.type).toBe(eventType)
    expect(sample.id).toMatch(/^evt_sample_/)
    expect(sample.timestamp).toBeTruthy()
    expect(sample.actor).toBeTruthy()
    expect(sample.data).toBeTruthy()
  })

  it('contact.* samples carry a contact ref', () => {
    for (const t of CRM_EVENTS.filter((e) => e.startsWith('contact.'))) {
      const s = getSampleEventPayload(t)
      // @ts-expect-error narrow at runtime
      expect(s.data.contact?.id).toBe('contact_sample')
    }
  })

  it('organization.* samples carry an organization ref', () => {
    for (const t of CRM_EVENTS.filter((e) => e.startsWith('organization.'))) {
      const s = getSampleEventPayload(t)
      // @ts-expect-error narrow at runtime
      expect(s.data.organization?.id).toBe('org_sample')
    }
  })

  it('contact.updated and organization.updated carry changedFields', () => {
    const c = getSampleEventPayload('contact.updated')
    const o = getSampleEventPayload('organization.updated')
    // @ts-expect-error narrow at runtime
    expect(Array.isArray(c.data.changedFields)).toBe(true)
    // @ts-expect-error narrow at runtime
    expect(Array.isArray(o.data.changedFields)).toBe(true)
  })

  it('contact.linked carries userId + linkedByPrincipalId', () => {
    const s = getSampleEventPayload('contact.linked')
    // @ts-expect-error narrow at runtime
    expect(s.data.userId).toBeTruthy()
    // @ts-expect-error narrow at runtime
    expect(s.data.linkedByPrincipalId).toBeTruthy()
  })
})
