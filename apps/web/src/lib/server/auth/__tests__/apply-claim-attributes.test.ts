import { describe, it, expect } from 'vitest'
import { planClaimAttributeWrites } from '../apply-claim-attributes'

const defs = [
  { key: 'department', type: 'string' as const },
  { key: 'mrr', type: 'number' as const },
  { key: 'active', type: 'boolean' as const },
]

describe('planClaimAttributeWrites', () => {
  it('writes only keys that exist on the definition list', () => {
    const { valid } = planClaimAttributeWrites({
      claims: { dept: 'Eng', unknown: 'x' },
      mapping: {
        map: [
          { claimPath: 'dept', attributeKey: 'department' },
          { claimPath: 'unknown', attributeKey: 'nope' },
        ],
      },
      existing: {},
      definitions: defs,
    })
    expect(valid).toEqual({ department: 'Eng' })
  })

  it('coerces by the definition type', () => {
    const { valid } = planClaimAttributeWrites({
      claims: { mrr: '42', active: 'true' },
      mapping: {
        map: [
          { claimPath: 'mrr', attributeKey: 'mrr' },
          { claimPath: 'active', attributeKey: 'active' },
        ],
      },
      existing: {},
      definitions: defs,
    })
    expect(valid).toEqual({ mrr: 42, active: true })
  })

  it('does not override an existing value unless asked', () => {
    const { valid } = planClaimAttributeWrites({
      claims: { dept: 'Sales' },
      mapping: { map: [{ claimPath: 'dept', attributeKey: 'department' }] },
      existing: { department: 'Eng' },
      definitions: defs,
    })
    expect(valid).toEqual({})
  })

  it('overrides when overrideExisting is on', () => {
    const { valid } = planClaimAttributeWrites({
      claims: { dept: 'Sales' },
      mapping: {
        map: [{ claimPath: 'dept', attributeKey: 'department' }],
        overrideExisting: true,
      },
      existing: { department: 'Eng' },
      definitions: defs,
    })
    expect(valid).toEqual({ department: 'Sales' })
  })

  it('clears a value when sync is on and the claim disappears', () => {
    const { valid, removals } = planClaimAttributeWrites({
      claims: {},
      mapping: {
        map: [{ claimPath: 'dept', attributeKey: 'department' }],
        syncOnSignIn: true,
      },
      existing: { department: 'Eng' },
      definitions: defs,
    })
    expect(valid).toEqual({})
    expect(removals).toEqual(['department'])
  })

  it('does not clear a disappeared claim when sync is off', () => {
    const { removals } = planClaimAttributeWrites({
      claims: {},
      mapping: { map: [{ claimPath: 'dept', attributeKey: 'department' }] },
      existing: { department: 'Eng' },
      definitions: defs,
    })
    expect(removals).toEqual([])
  })

  it('resolves a nested claim path', () => {
    const { valid } = planClaimAttributeWrites({
      claims: { org: { department: 'Eng' } },
      mapping: { map: [{ claimPath: 'org.department', attributeKey: 'department' }] },
      existing: {},
      definitions: defs,
    })
    expect(valid).toEqual({ department: 'Eng' })
  })

  it('treats an array of objects into a string attribute as a type mismatch', () => {
    const { valid, skips } = planClaimAttributeWrites({
      claims: { groups: [{ id: '1' }, { id: '2' }] },
      mapping: { map: [{ claimPath: 'groups', attributeKey: 'department' }] },
      existing: {},
      definitions: defs,
      explain: true,
    })
    expect(valid).toEqual({})
    expect(skips).toEqual([{ key: 'department', reason: 'type_mismatch' }])
  })

  it('joins an array of primitives into a string attribute', () => {
    const { valid } = planClaimAttributeWrites({
      claims: { groups: ['eng', 'sales'] },
      mapping: { map: [{ claimPath: 'groups', attributeKey: 'department' }] },
      existing: {},
      definitions: defs,
    })
    expect(valid).toEqual({ department: 'eng,sales' })
  })
})
