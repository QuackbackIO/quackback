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

  it("every 'workspace' category key is in the admin boundary (Manager cannot silently gain one)", () => {
    // The flagship invariant made STRUCTURAL: Manager = ALL minus WORKSPACE_ADMIN_PERMISSIONS, so a
    // workspace-category key left out of the boundary would leak to Manager the moment it is enforced.
    // Category and boundary must agree by construction, not by discipline.
    for (const p of PERMISSION_CATALOGUE) {
      if (p.category === 'workspace') {
        expect(WORKSPACE_ADMIN_PERMISSIONS).toContain(p.key)
      }
    }
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
    // Sorts feedback (triage) + operates the inbox...
    expect(c).toContain(PERMISSIONS.POST_SET_STATUS)
    expect(c).toContain(PERMISSIONS.POST_SET_TAGS)
    expect(c).toContain(PERMISSIONS.CONVERSATION_REPLY)
    // ...but NOT destructive edit / identity (triage without destructive edit)...
    expect(c).not.toContain(PERMISSIONS.POST_EDIT)
    expect(c).not.toContain(PERMISSIONS.POST_DELETE)
    expect(c).not.toContain(PERMISSIONS.POST_SET_AUTHOR)
    // ...and does not configure product structure or settings.
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

  it('carries the granular operator keys and the post.moderate umbrella is gone', () => {
    // The coarse post.moderate umbrella was split into field-level keys and removed.
    expect(ALL_PERMISSIONS).not.toContain('post.moderate')
    for (const key of [
      PERMISSIONS.POST_EDIT,
      PERMISSIONS.POST_DELETE,
      PERMISSIONS.POST_SET_STATUS,
      PERMISSIONS.POST_SET_BOARD,
      PERMISSIONS.POST_SET_TAGS,
      PERMISSIONS.POST_SET_OWNER,
      PERMISSIONS.POST_SET_AUTHOR,
      PERMISSIONS.POST_MERGE,
      PERMISSIONS.COMMENT_EDIT,
      PERMISSIONS.COMMENT_PIN,
      PERMISSIONS.CONVERSATION_SET_STATUS,
      PERMISSIONS.CONVERSATION_SET_TAGS,
      PERMISSIONS.CONVERSATION_MANAGE_TAGS,
      PERMISSIONS.SETTINGS_BRANDING,
      PERMISSIONS.SETTINGS_MODERATION,
    ]) {
      expect(ALL_PERMISSIONS).toContain(key)
    }
    expect(PERMISSION_CATEGORIES).toContain('survey')
  })

  it('keeps Manager out of the split settings keys', () => {
    for (const key of [
      PERMISSIONS.SETTINGS_BRANDING,
      PERMISSIONS.SETTINGS_MODERATION,
      PERMISSIONS.SETTINGS_NOTIFICATIONS,
      PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
    ]) {
      expect(WORKSPACE_ADMIN_PERMISSIONS).toContain(key)
      expect(SYSTEM_ROLE_PERMISSIONS.manager).not.toContain(key)
    }
  })

  it('tickets are a peer aggregate with their own scoped resource verbs', () => {
    // Tickets carry their OWN verbs (distinct from conversation.*), team-scoped for humans and
    // workspace-scoped for machine/AI principals. View-scope stays a FILTER, so ticket.view_assigned
    // is NOT a key; inbox.manage was renamed to channel_account.manage.
    for (const gone of ['ticket.view_assigned', 'inbox.manage']) {
      expect(ALL_PERMISSIONS).not.toContain(gone)
    }
    for (const key of [
      PERMISSIONS.TICKET_VIEW,
      PERMISSIONS.TICKET_VIEW_ALL,
      PERMISSIONS.TICKET_REPLY,
      PERMISSIONS.TICKET_NOTE,
      PERMISSIONS.TICKET_ASSIGN,
      PERMISSIONS.TICKET_SET_STATUS,
      PERMISSIONS.TICKET_CREATE,
      PERMISSIONS.CONVERSATION_VIEW_ALL,
      PERMISSIONS.CHANNEL_ACCOUNT_MANAGE,
    ]) {
      expect(ALL_PERMISSIONS).toContain(key)
    }
  })

  it('support infrastructure config is admin-only', () => {
    // Manager operates the inbox but does not configure the support infrastructure.
    for (const key of [
      PERMISSIONS.SLA_MANAGE,
      PERMISSIONS.ROUTING_MANAGE,
      PERMISSIONS.TEAM_MANAGE,
      PERMISSIONS.WORKFLOW_MANAGE,
      PERMISSIONS.CHANNEL_ACCOUNT_MANAGE,
    ]) {
      expect(WORKSPACE_ADMIN_PERMISSIONS).toContain(key)
      expect(SYSTEM_ROLE_PERMISSIONS.manager).not.toContain(key)
    }
    // Ticket operator verbs + manage-types are NOT admin-only — Manager holds them.
    expect(SYSTEM_ROLE_PERMISSIONS.manager).toContain(PERMISSIONS.TICKET_REPLY)
    expect(SYSTEM_ROLE_PERMISSIONS.manager).toContain(PERMISSIONS.TICKET_MANAGE_TYPES)
  })
})
