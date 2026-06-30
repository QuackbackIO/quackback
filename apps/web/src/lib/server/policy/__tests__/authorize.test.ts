import { describe, it, expect } from 'vitest'
import { can, authorize } from '../authorize'
import { resolveActorPermissions } from '../permissions'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import { PERMISSIONS, type PermissionKey } from '@/lib/server/db'

function actorWith(perms: PermissionKey[]): Actor {
  return {
    principalId: null,
    role: 'member',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set(perms),
  }
}

describe('policy authorize', () => {
  it('can() reads the resolved permission set', () => {
    const a = actorWith([PERMISSIONS.POST_MODERATE])
    expect(can(a, PERMISSIONS.POST_MODERATE)).toBe(true)
    expect(can(a, PERMISSIONS.SETTINGS_MANAGE)).toBe(false)
  })

  it('can() treats an absent permission set as no permissions', () => {
    const noPerms: Actor = {
      principalId: null,
      role: 'admin',
      principalType: 'user',
      segmentIds: new Set(),
    }
    expect(can(noPerms, PERMISSIONS.SETTINGS_MANAGE)).toBe(false)
    expect(can(ANONYMOUS_ACTOR, PERMISSIONS.POST_CREATE)).toBe(false)
  })

  it('authorize() returns a reasoned decision', () => {
    const a = actorWith([PERMISSIONS.POST_MODERATE])
    expect(authorize(a, PERMISSIONS.POST_MODERATE)).toEqual({ allowed: true })
    const denied = authorize(a, PERMISSIONS.SETTINGS_MANAGE)
    expect(denied.allowed).toBe(false)
    if (!denied.allowed) expect(denied.reason).toContain('insufficient_permission')
  })

  it('resolveActorPermissions expands the role (null/anonymous -> empty)', () => {
    expect(resolveActorPermissions('admin').has(PERMISSIONS.BILLING_MANAGE)).toBe(true)
    expect(resolveActorPermissions('member').has(PERMISSIONS.SETTINGS_MANAGE)).toBe(false)
    expect(resolveActorPermissions('member').has(PERMISSIONS.POST_MODERATE)).toBe(true)
    expect(resolveActorPermissions('user').size).toBe(0)
    expect(resolveActorPermissions(null).size).toBe(0)
  })
})
