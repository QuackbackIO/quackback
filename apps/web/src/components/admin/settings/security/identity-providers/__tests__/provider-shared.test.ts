/**
 * `claim_mapping` is one jsonb column with named sections, now written by two
 * different cards — and `attributes` (plus the parts of `profile` that have no
 * UI) is written by neither. These helpers are the reason a card can save its
 * own section without erasing the ones it does not render, so they are tested
 * as the invariant rather than through the components that use them.
 */
import { describe, it, expect } from 'vitest'
import {
  identityMappingIssue,
  mergeClaimMapping,
  normalizeAttributeMapping,
  normalizeRoleMapping,
  withAllowMissingEmail,
} from '../provider-shared'

describe('mergeClaimMapping', () => {
  it('persists null when nothing is configured', () => {
    expect(mergeClaimMapping(null, { role: undefined, profile: undefined })).toBeNull()
  })

  it('carries the attributes section through verbatim', () => {
    const attributes = { map: [{ claimPath: 'dept', attributeKey: 'department' }] }
    const next = mergeClaimMapping({ attributes }, { role: { claimPath: 'groups', rules: [] } })
    expect(next?.attributes).toEqual(attributes)
  })

  it('keeps an untouched section when another one is written', () => {
    const next = mergeClaimMapping(
      { role: { claimPath: 'groups', rules: [{ whenContains: 'a', role: 'admin' }] } },
      { profile: { allowMissingEmail: true } }
    )
    expect(next?.role?.claimPath).toBe('groups')
    expect(next?.profile?.allowMissingEmail).toBe(true)
  })

  it('drops a section written as undefined', () => {
    const next = mergeClaimMapping(
      { role: { claimPath: 'groups', rules: [] }, profile: { allowMissingEmail: true } },
      { profile: undefined }
    )
    expect(next).not.toBeNull()
    expect(next).not.toHaveProperty('profile')
  })

  it('returns null once the last section is dropped', () => {
    expect(
      mergeClaimMapping({ profile: { allowMissingEmail: true } }, { profile: undefined })
    ).toBe(null)
  })
})

describe('withAllowMissingEmail', () => {
  it('writes no key when the opt-in is off', () => {
    // Absent means "not configured" everywhere else in this column; an
    // explicit false would make an untouched provider look deliberate.
    expect(withAllowMissingEmail(undefined, false)).toBeUndefined()
  })

  it('keeps the rest of the profile section when turning the opt-in off', () => {
    const profile = { claims: { email: 'mail' }, allowMissingEmail: true }
    expect(withAllowMissingEmail(profile, false)).toEqual({ claims: { email: 'mail' } })
  })

  it('keeps the rest of the profile section when turning the opt-in on', () => {
    const profile = { sources: ['idToken' as const] }
    expect(withAllowMissingEmail(profile, true)).toEqual({
      sources: ['idToken'],
      allowMissingEmail: true,
    })
  })
})

describe('normalizeAttributeMapping', () => {
  it('drops empty rows and returns undefined when nothing remains', () => {
    expect(
      normalizeAttributeMapping({
        map: [
          { claimPath: '', attributeKey: 'department' },
          { claimPath: 'dept', attributeKey: '  ' },
        ],
      })
    ).toBeUndefined()
    expect(normalizeAttributeMapping({ map: [] })).toBeUndefined()
    expect(normalizeAttributeMapping(null)).toBeUndefined()
  })

  it('preserves flags on a non-empty mapping', () => {
    expect(
      normalizeAttributeMapping({
        map: [{ claimPath: 'dept', attributeKey: 'department' }],
        overrideExisting: true,
        syncOnSignIn: true,
      })
    ).toEqual({
      map: [{ claimPath: 'dept', attributeKey: 'department' }],
      overrideExisting: true,
      syncOnSignIn: true,
    })
  })

  it('drops flags that are off so the stored shape stays sparse', () => {
    expect(
      normalizeAttributeMapping({
        map: [{ claimPath: 'dept', attributeKey: 'department' }],
        overrideExisting: false,
        syncOnSignIn: false,
      })
    ).toEqual({ map: [{ claimPath: 'dept', attributeKey: 'department' }] })
  })
})

describe('normalizeRoleMapping', () => {
  it('drops a mapping with no rules and no sync', () => {
    expect(normalizeRoleMapping({ claimPath: 'groups', rules: [] })).toBeUndefined()
  })

  it('keeps a mapping with rules', () => {
    const m = { claimPath: 'groups', rules: [{ whenContains: 'a', role: 'admin' as const }] }
    expect(normalizeRoleMapping(m)).toBe(m)
  })

  it('keeps a rule-less mapping that syncs on every sign-in', () => {
    const m = { claimPath: 'groups', rules: [], syncOnEverySignIn: true }
    expect(normalizeRoleMapping(m)).toBe(m)
  })
})

describe('identityMappingIssue', () => {
  it('says nothing for a provider with no mapping', () => {
    expect(identityMappingIssue(null)).toBeNull()
  })

  it('says nothing for a working rule', () => {
    expect(
      identityMappingIssue({
        role: { claimPath: 'groups', rules: [{ whenContains: 'eng', role: 'member' }] },
      })
    ).toBeNull()
  })

  it('flags a rule that can never match', () => {
    expect(
      identityMappingIssue({
        role: { claimPath: 'groups', rules: [{ whenContains: '  ', role: 'admin' }] },
      })
    ).toMatch(/no value/i)
  })

  it('flags a mapping with no claim path', () => {
    expect(
      identityMappingIssue({
        role: { claimPath: '', rules: [{ whenContains: 'eng', role: 'member' }] },
      })
    ).toMatch(/claim path/i)
  })

  it('flags sync-on-every-sign-in with nothing to apply', () => {
    expect(
      identityMappingIssue({ role: { claimPath: 'groups', rules: [], syncOnEverySignIn: true } })
    ).toMatch(/no rules/i)
  })
})
