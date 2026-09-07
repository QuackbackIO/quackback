import { describe, expect, it } from 'vitest'
import {
  applyClaimMappingEdits,
  diffClaimMappingOperations,
  effectiveProfileSignature,
  mappingSaveRisks,
  mappingWouldStripUnsupported,
  storedJsonEqual,
} from '../sso-claim-mapping-edit'

describe('applyClaimMappingEdits', () => {
  it('editing one mapping preserves all saved rows and unknown siblings', () => {
    const raw = {
      profile: {
        claims: { email: 'upn' },
        extra: { nested: true },
        longPath: 'x'.repeat(300),
      },
      role: {
        claimPath: 'groups',
        rules: [{ whenContains: 'eng', role: 'member', note: 'keep' }],
        custom: 1,
      },
      attributes: {
        map: [
          { claimPath: 'dept', attributeKey: 'department', extra: 'row' },
          { claimPath: 'gone', attributeKey: 'deleted_def' },
          { claimPath: 'dept', attributeKey: 'department' },
        ],
      },
      unknownSection: { keep: true },
    }
    const next = applyClaimMappingEdits(raw, [
      { op: 'setProfileClaim', field: 'name', path: 'preferred_username' },
    ]) as Record<string, unknown>
    expect(next.unknownSection).toEqual({ keep: true })
    expect((next.profile as Record<string, unknown>).extra).toEqual({ nested: true })
    expect((next.profile as Record<string, unknown>).longPath).toHaveLength(300)
    expect((next.role as Record<string, unknown>).custom).toBe(1)
    expect(((next.role as Record<string, unknown>).rules as object[])[0]).toEqual({
      whenContains: 'eng',
      role: 'member',
      note: 'keep',
    })
    expect((next.attributes as { map: unknown[] }).map).toHaveLength(3)
    expect((next.profile as { claims: { name: string } }).claims.name).toBe('preferred_username')
  })

  it('no-op save preserves original JSON', () => {
    const raw = { role: { claimPath: 'groups', rules: [{ whenContains: 'a', role: 'admin' }] } }
    expect(applyClaimMappingEdits(raw, [])).toEqual(raw)
  })
})

describe('effectiveProfileSignature', () => {
  it('treats explicit default sources and object key reorder as the same as implicit defaults', () => {
    const implicit = effectiveProfileSignature(null)
    const explicit = effectiveProfileSignature({
      profile: { sources: ['idToken', 'userinfo'], allowMissingEmail: false },
    })
    const reordered = effectiveProfileSignature({
      profile: { allowMissingEmail: false, sources: ['idToken', 'userinfo'] },
    })
    expect(explicit).toBe(implicit)
    expect(reordered).toBe(implicit)
  })

  it('treats explicit id: sub as different from implicit default', () => {
    expect(effectiveProfileSignature({ profile: { claims: { id: 'sub' } } })).not.toBe(
      effectiveProfileSignature(null)
    )
  })

  it('role-only and People-only edits do not change the profile signature', () => {
    const before = { profile: { claims: { email: 'upn' } } }
    const roleOnly = applyClaimMappingEdits(before, [
      { op: 'setRolePath', claimPath: 'groups' },
      { op: 'insertRoleRule', index: 0, rule: { whenContains: 'eng', role: 'member' } },
    ])
    const peopleOnly = applyClaimMappingEdits(before, [
      {
        op: 'insertPeopleMapping',
        index: 0,
        entry: { claimPath: 'dept', attributeKey: 'department' },
      },
    ])
    expect(effectiveProfileSignature(roleOnly)).toBe(effectiveProfileSignature(before))
    expect(effectiveProfileSignature(peopleOnly)).toBe(effectiveProfileSignature(before))
  })
})

describe('mappingSaveRisks', () => {
  it('identifier edit is detected for id path and sources', () => {
    expect(mappingSaveRisks(null, { profile: { claims: { id: 'oid' } } }).identifierChanged).toBe(
      true
    )
    expect(mappingSaveRisks(null, { profile: { sources: ['userinfo'] } }).identifierChanged).toBe(
      true
    )
  })

  it('admin rule save requires acknowledgement even when tester would be member', () => {
    const after = {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'platform-admins', role: 'admin' },
          { whenContains: 'engineering', role: 'member' },
        ],
      },
    }
    const risks = mappingSaveRisks(null, after)
    expect(risks.hasAdminRules).toBe(true)
    expect(risks.adminRules).toHaveLength(1)
  })
})

describe('diffClaimMappingOperations', () => {
  it('default Save with Advanced sources mounted does not invent mapping ops', () => {
    const ops = diffClaimMappingOperations(null, {
      profile: { sources: ['idToken', 'userinfo'] },
    })
    expect(ops).toEqual([])
    const after = applyClaimMappingEdits(null, ops)
    expect(effectiveProfileSignature(after)).toBe(effectiveProfileSignature(null))
  })

  it('reordering rules emits reorderRoleRule so extra fields move with the rule', () => {
    const stored = {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'eng', role: 'member', note: 'eng-note' },
          { whenContains: 'admins', role: 'admin', note: 'admin-note' },
        ],
      },
    }
    const ops = diffClaimMappingOperations(stored, {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'admins', role: 'admin' },
          { whenContains: 'eng', role: 'member' },
        ],
      },
    })
    expect(ops).toEqual([{ op: 'reorderRoleRule', from: 1, to: 0 }])
    expect(applyClaimMappingEdits(stored, ops)).toEqual({
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'admins', role: 'admin', note: 'admin-note' },
          { whenContains: 'eng', role: 'member', note: 'eng-note' },
        ],
      },
    })
  })

  it('deleting a non-tail rule removes that row so extra fields stay with survivors', () => {
    const stored = {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'eng', role: 'member', note: 'eng-note' },
          { whenContains: 'admins', role: 'admin', note: 'admin-note' },
        ],
      },
    }
    const ops = diffClaimMappingOperations(stored, {
      role: {
        claimPath: 'groups',
        rules: [{ whenContains: 'admins', role: 'admin' }],
      },
    })
    expect(ops).toEqual([{ op: 'removeRoleRule', index: 0 }])
    expect(applyClaimMappingEdits(stored, ops)).toEqual({
      role: {
        claimPath: 'groups',
        rules: [{ whenContains: 'admins', role: 'admin', note: 'admin-note' }],
      },
    })
  })

  it('reorder+remove keeps extra fields on the surviving objects', () => {
    const stored = {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'a', role: 'member', note: 'a-note' },
          { whenContains: 'b', role: 'member', note: 'b-note' },
          { whenContains: 'c', role: 'admin', note: 'c-note' },
        ],
      },
    }
    const ops = diffClaimMappingOperations(stored, {
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'c', role: 'admin' },
          { whenContains: 'a', role: 'member' },
        ],
      },
    })
    expect(ops).toEqual([
      { op: 'removeRoleRule', index: 1 },
      { op: 'reorderRoleRule', from: 1, to: 0 },
    ])
    expect(applyClaimMappingEdits(stored, ops)).toEqual({
      role: {
        claimPath: 'groups',
        rules: [
          { whenContains: 'c', role: 'admin', note: 'c-note' },
          { whenContains: 'a', role: 'member', note: 'a-note' },
        ],
      },
    })
  })
})

describe('storedJsonEqual', () => {
  it('ignores object key reorder', () => {
    expect(storedJsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
  })
})

describe('mappingWouldStripUnsupported', () => {
  const stored = {
    profile: { claims: { email: 'upn' }, extra: true },
    role: {
      claimPath: 'groups',
      rules: [{ whenContains: 'eng', role: 'member', note: 'keep' }],
      custom: 1,
    },
    attributes: {
      map: [{ claimPath: 'dept', attributeKey: 'department', extra: 'row' }],
      label: 'people',
    },
    unknownSection: { keep: true },
  }

  it('rejects a typed mapping DTO that would drop nested unknown siblings', () => {
    const typed = {
      profile: { claims: { email: 'upn' } },
      role: {
        claimPath: 'groups',
        rules: [{ whenContains: 'eng', role: 'member' }],
      },
      attributes: {
        map: [{ claimPath: 'dept', attributeKey: 'department' }],
      },
    }
    expect(mappingWouldStripUnsupported(stored, typed)).toBe(true)
    expect(
      mappingWouldStripUnsupported(stored, {
        ...stored,
        role: { claimPath: 'groups', rules: stored.role.rules },
      })
    ).toBe(true)
    expect(
      mappingWouldStripUnsupported(stored, {
        ...stored,
        role: { ...stored.role, rules: [{ whenContains: 'eng', role: 'member' }] },
      })
    ).toBe(true)
    expect(
      mappingWouldStripUnsupported(stored, {
        ...stored,
        attributes: { map: stored.attributes.map },
      })
    ).toBe(true)
    expect(
      mappingWouldStripUnsupported(stored, {
        ...stored,
        attributes: {
          ...stored.attributes,
          map: [{ claimPath: 'dept', attributeKey: 'department' }],
        },
      })
    ).toBe(true)
  })

  it('lets an unchanged mapping with extras round-trip', () => {
    expect(mappingWouldStripUnsupported(stored, { ...stored })).toBe(false)
    expect(
      mappingWouldStripUnsupported(stored, {
        unknownSection: { keep: true },
        attributes: stored.attributes,
        role: stored.role,
        profile: stored.profile,
      })
    ).toBe(false)
  })

  it('does not treat deleting a fully supported section as stripping extras', () => {
    expect(
      mappingWouldStripUnsupported(
        { role: { claimPath: 'groups', rules: [{ whenContains: 'eng', role: 'member' }] } },
        { profile: { allowMissingEmail: true } }
      )
    ).toBe(false)
  })
})
