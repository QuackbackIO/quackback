/**
 * NotificationType ↔ NOTIFICATION_CATALOG bijection. The catalog's `type`
 * field being typed NotificationType already guarantees catalog ⊆ union at
 * compile time; this pins the other direction. ALL_TYPES is compiler-enforced
 * exhaustive (adding a union member without extending it is a type error), so
 * a new type that forgets its catalog row fails here instead of silently
 * shipping an un-configurable notification.
 */
import { describe, it, expect } from 'vitest'
import { NOTIFICATION_CATALOG } from '../catalog'
import type { NotificationType } from '@/lib/server/domains/notifications/notification.types'

const ALL_TYPES: Record<NotificationType, true> = {
  post_status_changed: true,
  comment_created: true,
  post_mentioned: true,
  changelog_published: true,
  status_incident: true,
  chat_message: true,
  chat_mention: true,
  ticket_status_changed: true,
  conversation_assigned: true,
  ticket_assigned: true,
  ticket_replied: true,
  ticket_note_added: true,
  ticket_created: true,
  sla_warning: true,
  sla_breach: true,
  comment_mentioned: true,
  assistant_handed_off: true,
}

describe('notification catalog bijection', () => {
  it('every NotificationType has exactly one catalog entry', () => {
    const catalogTypes = NOTIFICATION_CATALOG.map((e) => e.type)
    expect(new Set(catalogTypes).size).toBe(catalogTypes.length)
    expect([...catalogTypes].sort()).toEqual(Object.keys(ALL_TYPES).sort())
  })
})
