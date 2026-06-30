import { describe, it, expect } from 'vitest'
import {
  PERMISSIONS,
  ALL_PERMISSIONS,
  PERMISSION_CATALOGUE,
  PERMISSION_CATEGORIES,
  WORKSPACE_ADMIN_PERMISSIONS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_DEFS,
  SYSTEM_ROLE_PERMISSIONS,
  presetForLegacyRole,
} from '../rbac-catalogue'

const asSet = (xs: readonly string[]) => new Set(xs)

describe('RBAC permission catalogue', () => {
  it('has no duplicate permission keys', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length)
  })

  it('the catalogue is a bijection with PERMISSIONS', () => {
    const catalogueKeys = PERMISSION_CATALOGUE.map((p) => p.key)
    expect(new Set(catalogueKeys).size).toBe(catalogueKeys.length) // no dups
    expect(asSet(catalogueKeys)).toEqual(asSet(ALL_PERMISSIONS))
    expect(PERMISSION_CATALOGUE.length).toBe(ALL_PERMISSIONS.length)
  })

  it('every catalogue entry has a known category and a description', () => {
    for (const p of PERMISSION_CATALOGUE) {
      expect(PERMISSION_CATEGORIES).toContain(p.category)
      expect(p.description.length).toBeGreaterThan(0)
    }
  })

  it('the workspace-admin boundary is a subset with no duplicates', () => {
    expect(new Set(WORKSPACE_ADMIN_PERMISSIONS).size).toBe(WORKSPACE_ADMIN_PERMISSIONS.length)
    for (const p of WORKSPACE_ADMIN_PERMISSIONS) expect(ALL_PERMISSIONS).toContain(p)
  })

  it('Owner is the whole catalogue', () => {
    expect(asSet(SYSTEM_ROLE_PERMISSIONS.owner)).toEqual(asSet(ALL_PERMISSIONS))
  })

  it('Admin is everything except billing', () => {
    expect(asSet(SYSTEM_ROLE_PERMISSIONS.admin)).toEqual(
      asSet(ALL_PERMISSIONS.filter((p) => p !== PERMISSIONS.BILLING_MANAGE))
    )
    expect(SYSTEM_ROLE_PERMISSIONS.admin).not.toContain(PERMISSIONS.BILLING_MANAGE)
  })

  it('Manager is everything except the workspace-admin set (non-regressing reads kept)', () => {
    expect(asSet(SYSTEM_ROLE_PERMISSIONS.manager)).toEqual(
      asSet(ALL_PERMISSIONS.filter((p) => !WORKSPACE_ADMIN_PERMISSIONS.includes(p)))
    )
    // The reads a legacy `member` keeps must survive the mapping.
    expect(SYSTEM_ROLE_PERMISSIONS.manager).toContain(PERMISSIONS.MEMBER_VIEW)
    expect(SYSTEM_ROLE_PERMISSIONS.manager).toContain(PERMISSIONS.INTEGRATION_VIEW)
    // ...but never the workspace-admin writes.
    expect(SYSTEM_ROLE_PERMISSIONS.manager).not.toContain(PERMISSIONS.MEMBER_MANAGE)
    expect(SYSTEM_ROLE_PERMISSIONS.manager).not.toContain(PERMISSIONS.INTEGRATION_MANAGE)
    expect(SYSTEM_ROLE_PERMISSIONS.manager).not.toContain(PERMISSIONS.SETTINGS_MANAGE)
  })

  it('Contributor is a deduped subset that stops at the config boundary', () => {
    const c = SYSTEM_ROLE_PERMISSIONS.contributor
    expect(new Set(c).size).toBe(c.length)
    for (const p of c) expect(ALL_PERMISSIONS).toContain(p)
    // Operates feedback + inbox...
    expect(c).toContain(PERMISSIONS.POST_MODERATE)
    expect(c).toContain(PERMISSIONS.CONVERSATION_REPLY)
    // ...but does not configure product structure or settings.
    expect(c).not.toContain(PERMISSIONS.BOARD_MANAGE)
    expect(c).not.toContain(PERMISSIONS.SETTINGS_MANAGE)
    expect(c).not.toContain(PERMISSIONS.SEGMENT_MANAGE)
  })

  it('there are exactly four system roles with matching defs and bundles', () => {
    const roleKeys = Object.values(SYSTEM_ROLES)
    expect(roleKeys.length).toBe(4)
    expect(asSet(SYSTEM_ROLE_DEFS.map((r) => r.key))).toEqual(asSet(roleKeys))
    expect(asSet(Object.keys(SYSTEM_ROLE_PERMISSIONS))).toEqual(asSet(roleKeys))
  })

  it('maps the legacy roles non-regressively', () => {
    expect(presetForLegacyRole('admin')).toBe(SYSTEM_ROLES.OWNER)
    expect(presetForLegacyRole('member')).toBe(SYSTEM_ROLES.MANAGER)
    expect(presetForLegacyRole('user')).toBeNull()
    expect(presetForLegacyRole('anything-else')).toBeNull()
  })
})
