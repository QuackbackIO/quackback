/**
 * The seat classification must cover the permission catalogue exactly.
 *
 * This is the test that makes a "lite seat" safe to sell. The classification
 * decides money: a teammate holding only read-only permissions is billed at
 * the reduced rate. If a permission is added and nobody classifies it, one of
 * two silent failures follows — an unclassified *write* permission would let
 * a fully-capable teammate be billed as a viewer, and an unclassified *view*
 * permission would bill a viewer at the full rate. Neither shows up anywhere.
 *
 * So the assertion is totality and disjointness against the live catalogue,
 * not a spot check of a few keys.
 */
import { describe, expect, it } from 'vitest'
import { ALL_PERMISSIONS, PERMISSIONS } from '@/lib/shared/permissions'
import {
  CLASSIFIED_PERMISSIONS,
  READ_ONLY_PERMISSIONS,
  WRITE_PERMISSIONS,
  unclassifiedPermissions,
} from '../permission-classes'

describe('seat permission classification', () => {
  it('classifies every permission in the catalogue', () => {
    // Names, not a count: a failure has to say which key was forgotten,
    // because "expected 89, got 88" sends the reader back to a diff.
    expect(unclassifiedPermissions()).toEqual([])
  })

  it('classifies no permission twice', () => {
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const key of CLASSIFIED_PERMISSIONS) {
      if (seen.has(key)) duplicates.push(key)
      seen.add(key)
    }
    expect(duplicates).toEqual([])
  })

  it('classifies nothing that is not in the catalogue', () => {
    const live = new Set<string>(ALL_PERMISSIONS)
    expect(CLASSIFIED_PERMISSIONS.filter((key) => !live.has(key))).toEqual([])
  })

  it('partitions the catalogue exactly', () => {
    // The strongest form: the two lists together ARE the catalogue, as sets.
    expect([...CLASSIFIED_PERMISSIONS].sort()).toEqual([...ALL_PERMISSIONS].sort())
  })

  it('treats the borderline cases the way the module documents', () => {
    const readOnly = new Set<string>(READ_ONLY_PERMISSIONS)
    const write = new Set<string>(WRITE_PERMISSIONS)

    // Spending money and posting drafts is not passive viewing — and this
    // one is separately billed as the Copilot add-on.
    expect(write.has(PERMISSIONS.COPILOT_USE)).toBe(true)
    // Widening visibility is not mutation, however sensitive the data.
    expect(readOnly.has(PERMISSIONS.POST_VIEW_PRIVATE)).toBe(true)
    expect(readOnly.has(PERMISSIONS.AUDIT_VIEW)).toBe(true)
    expect(readOnly.has(PERMISSIONS.CONVERSATION_VIEW_ALL)).toBe(true)
    // Reading back a signing secret is a manage operation; listing is not.
    expect(readOnly.has(PERMISSIONS.WEBHOOK_VIEW)).toBe(true)
    expect(write.has(PERMISSIONS.WEBHOOK_MANAGE)).toBe(true)
    // Publishing changes what customers see.
    expect(write.has(PERMISSIONS.STATUS_PAGE_PUBLISH)).toBe(true)
  })
})
