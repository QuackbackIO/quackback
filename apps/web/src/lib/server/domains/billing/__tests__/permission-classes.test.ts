/**
 * The seat classification must cover the customer-support surface exactly.
 *
 * This is the test that makes a "lite seat" safe to sell. The classification
 * decides money: a teammate with no support-side write is billed at the
 * reduced rate. If a support permission is added and nobody classifies it,
 * one of two silent failures follows — an unclassified *write* would let a
 * support agent be billed as a viewer, and an unclassified *read* is
 * harmless but leaves the surface half-described. Neither shows up anywhere.
 *
 * So the assertions are totality and disjointness against the surface derived
 * from the live catalogue, not a spot check of a few keys.
 */
import { describe, expect, it } from 'vitest'
import { ALL_PERMISSIONS, PERMISSIONS, PERMISSION_CATALOGUE } from '@/lib/shared/permissions'
import {
  CLASSIFIED_SUPPORT_PERMISSIONS,
  SUPPORT_READ_PERMISSIONS,
  SUPPORT_SURFACE_CATEGORIES,
  SUPPORT_SURFACE_EXTRAS,
  SUPPORT_SURFACE_PERMISSIONS,
  SUPPORT_WRITE_PERMISSIONS,
  offSurfaceClassifications,
  unclassifiedSupportPermissions,
} from '../permission-classes'

describe('the customer-support surface', () => {
  it('is derived from the catalogue, not restated', () => {
    // If this ever drifts, the derivation has stopped tracking the catalogue
    // and the anti-rot property below is gone with it.
    const fromCatalogue = PERMISSION_CATALOGUE.filter((entry) =>
      SUPPORT_SURFACE_CATEGORIES.includes(entry.category)
    ).map((entry) => entry.key)
    expect(SUPPORT_SURFACE_PERMISSIONS).toEqual([...fromCatalogue, ...SUPPORT_SURFACE_EXTRAS])
  })

  it('is a strict subset of the catalogue', () => {
    const live = new Set<string>(ALL_PERMISSIONS)
    expect(SUPPORT_SURFACE_PERMISSIONS.filter((key) => !live.has(key))).toEqual([])
    expect(SUPPORT_SURFACE_PERMISSIONS.length).toBeLessThan(ALL_PERMISSIONS.length)
  })

  it('excludes the surfaces the operator placed outside it', () => {
    // The definition is "read-only on the customer support side", so writing
    // on feedback, roadmaps, changelog or the status page must NOT make a
    // seat full. This is the assertion that distinguishes the chosen reading
    // from the competing one.
    const surface = new Set<string>(SUPPORT_SURFACE_PERMISSIONS)
    for (const key of [
      PERMISSIONS.POST_CREATE,
      PERMISSIONS.POST_EDIT,
      PERMISSIONS.ROADMAP_MANAGE,
      PERMISSIONS.BOARD_MANAGE,
      PERMISSIONS.CHANGELOG_MANAGE,
      PERMISSIONS.STATUS_PAGE_PUBLISH,
      PERMISSIONS.HELP_CENTER_MANAGE,
      PERMISSIONS.SETTINGS_MANAGE,
      PERMISSIONS.MEMBER_MANAGE,
    ]) {
      expect({ key, onSurface: surface.has(key) }).toEqual({ key, onSurface: false })
    }
  })

  it('includes the inbox and ticketing surfaces', () => {
    const surface = new Set<string>(SUPPORT_SURFACE_PERMISSIONS)
    for (const key of [
      PERMISSIONS.CONVERSATION_REPLY,
      PERMISSIONS.CONVERSATION_VIEW,
      PERMISSIONS.TICKET_REPLY,
      PERMISSIONS.TICKET_VIEW,
      PERMISSIONS.SLA_MANAGE,
      PERMISSIONS.ROUTING_MANAGE,
      PERMISSIONS.CHANNEL_ACCOUNT_MANAGE,
      // Filed under `ai`, pulled in by the explicit extras list.
      PERMISSIONS.COPILOT_USE,
    ]) {
      expect({ key, onSurface: surface.has(key) }).toEqual({ key, onSurface: true })
    }
  })
})

describe('seat permission classification', () => {
  it('classifies every permission on the support surface', () => {
    // Names, not a count: a failure has to say which key was forgotten,
    // because "expected 26, got 25" sends the reader back to a diff.
    expect(unclassifiedSupportPermissions()).toEqual([])
  })

  it('classifies nothing that is off the surface', () => {
    expect(offSurfaceClassifications()).toEqual([])
  })

  it('classifies no permission twice', () => {
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const key of CLASSIFIED_SUPPORT_PERMISSIONS) {
      if (seen.has(key)) duplicates.push(key)
      seen.add(key)
    }
    expect(duplicates).toEqual([])
  })

  it('partitions the surface exactly', () => {
    // The strongest form: the two lists together ARE the surface, as sets.
    expect([...CLASSIFIED_SUPPORT_PERMISSIONS].sort()).toEqual([...SUPPORT_SURFACE_PERMISSIONS].sort())
  })

  it('treats the borderline cases the way the module documents', () => {
    const read = new Set<string>(SUPPORT_READ_PERMISSIONS)
    const write = new Set<string>(SUPPORT_WRITE_PERMISSIONS)

    // Widening visibility is not acting.
    expect(read.has(PERMISSIONS.CONVERSATION_VIEW_ALL)).toBe(true)
    expect(read.has(PERMISSIONS.TICKET_VIEW_ALL)).toBe(true)
    // Shaping the queues and taxonomy every agent works from is acting.
    expect(write.has(PERMISSIONS.CONVERSATION_MANAGE_VIEWS)).toBe(true)
    expect(write.has(PERMISSIONS.CONVERSATION_MANAGE_TAGS)).toBe(true)
    // Deciding what happens to every conversation is acting, even without
    // touching one directly.
    expect(write.has(PERMISSIONS.SLA_MANAGE)).toBe(true)
    expect(write.has(PERMISSIONS.ROUTING_MANAGE)).toBe(true)
    expect(write.has(PERMISSIONS.WORKFLOW_MANAGE)).toBe(true)
    // An agent tool that acts inside a thread and spends AI budget.
    expect(write.has(PERMISSIONS.COPILOT_USE)).toBe(true)
  })

  it('does not treat configuring the AI agent as a support action', () => {
    // Deliberately outside the extras list: workspace configuration, in the
    // same class as settings.manage, rather than an action on a conversation.
    expect(SUPPORT_SURFACE_PERMISSIONS).not.toContain(PERMISSIONS.ASSISTANT_MANAGE)
  })
})
