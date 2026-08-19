import { describe, it, expect } from 'vitest'
import { quinnActor, ASSISTANT_PERMISSIONS } from '../assistant.actor'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { can } from '@/lib/server/policy/authorize'
import type { PrincipalId } from '@quackback/ids'

describe('assistant.actor', () => {
  it('quinnActor returns a service actor with given principalId', () => {
    const principalId = 'principal_xyz123' as PrincipalId
    const actor = quinnActor(principalId)

    expect(actor.principalId).toBe(principalId)
    expect(actor.principalType).toBe('service')
    expect(actor.role).toBe('admin')
    expect(actor.segmentIds.size).toBe(0)
  })

  it('quinnActor has explicit permissions set (no role fallback)', () => {
    const principalId = 'principal_xyz123' as PrincipalId
    const actor = quinnActor(principalId)

    // Explicitly set, not undefined (ensures can() uses the set, not role fallback)
    expect(actor.permissions).toBeDefined()
    expect(actor.permissions).toEqual(new Set(ASSISTANT_PERMISSIONS))
  })

  it('quinnActor can view and reply to conversations, publish team-only action notices, and record attributes', () => {
    const principalId = 'principal_xyz123' as PrincipalId
    const actor = quinnActor(principalId)

    expect(can(actor, PERMISSIONS.CONVERSATION_VIEW)).toBe(true)
    expect(can(actor, PERMISSIONS.CONVERSATION_VIEW_ALL)).toBe(true)
    expect(can(actor, PERMISSIONS.CONVERSATION_REPLY)).toBe(true)
    expect(can(actor, PERMISSIONS.TICKET_NOTE)).toBe(true)
    // Recording metadata facts learned mid-conversation (set_attribute) is
    // inside the autonomous remit: server-side only, AI-precedence rules, a
    // human-set value always wins.
    expect(can(actor, PERMISSIONS.CONVERSATION_SET_ATTRIBUTES)).toBe(true)
    // Raising a ticket from a reported problem is the support surface's core
    // escalation artifact — internal work, never outward action.
    expect(can(actor, PERMISSIONS.TICKET_CREATE)).toBe(true)
    expect(actor.permissions).toEqual(
      new Set([
        PERMISSIONS.CONVERSATION_VIEW,
        PERMISSIONS.CONVERSATION_VIEW_ALL,
        PERMISSIONS.CONVERSATION_REPLY,
        PERMISSIONS.TICKET_NOTE,
        PERMISSIONS.CONVERSATION_SET_ATTRIBUTES,
        PERMISSIONS.TICKET_CREATE,
      ])
    )
  })

  it('quinnActor cannot perform operations outside the permission set', () => {
    const principalId = 'principal_xyz123' as PrincipalId
    const actor = quinnActor(principalId)

    // Permissions outside the assistant boundary: workflow state and
    // customer-visible publishing stay teammate-approved.
    expect(can(actor, PERMISSIONS.MEMBER_MANAGE)).toBe(false)
    expect(can(actor, PERMISSIONS.SETTINGS_MANAGE)).toBe(false)
    expect(can(actor, PERMISSIONS.WORKFLOW_MANAGE)).toBe(false)
    expect(can(actor, PERMISSIONS.CONVERSATION_SET_STATUS)).toBe(false)
    expect(can(actor, PERMISSIONS.POST_CREATE)).toBe(false)
    expect(can(actor, PERMISSIONS.POST_VOTE_ON_BEHALF)).toBe(false)
  })

  it('ASSISTANT_PERMISSIONS is a non-empty set', () => {
    expect(ASSISTANT_PERMISSIONS.size).toBeGreaterThan(0)
    expect(ASSISTANT_PERMISSIONS.has(PERMISSIONS.CONVERSATION_REPLY)).toBe(true)
  })
})
