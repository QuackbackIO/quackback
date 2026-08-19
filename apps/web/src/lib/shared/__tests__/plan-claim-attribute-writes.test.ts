import { describe, it, expect } from 'vitest'
import { planClaimAttributeWrites } from '../plan-claim-attribute-writes'

const defs = [
  { key: 'department', type: 'string' as const },
  { key: 'mrr', type: 'number' as const },
]

describe('planClaimAttributeWrites explain mode', () => {
  it('reports missing_claim when the path is empty and nothing is cleared', () => {
    const { skips, valid } = planClaimAttributeWrites({
      claims: {},
      mapping: { map: [{ claimPath: 'dept', attributeKey: 'department' }] },
      existing: {},
      definitions: defs,
      explain: true,
    })
    expect(valid).toEqual({})
    expect(skips).toEqual([{ key: 'department', reason: 'missing_claim' }])
  })

  it('reports type_mismatch when the value cannot be coerced', () => {
    const { skips, valid } = planClaimAttributeWrites({
      claims: { mrr: 'not-a-number' },
      mapping: { map: [{ claimPath: 'mrr', attributeKey: 'mrr' }] },
      existing: {},
      definitions: defs,
      explain: true,
    })
    expect(valid).toEqual({})
    expect(skips).toEqual([{ key: 'mrr', reason: 'type_mismatch' }])
  })

  it('reports kept_existing when a value is already set and override is off', () => {
    const { skips, valid } = planClaimAttributeWrites({
      claims: { dept: 'Sales' },
      mapping: { map: [{ claimPath: 'dept', attributeKey: 'department' }] },
      existing: { department: 'Eng' },
      definitions: defs,
      explain: true,
    })
    expect(valid).toEqual({})
    expect(skips).toEqual([{ key: 'department', reason: 'kept_existing' }])
  })

  it('omits skips from the default return', () => {
    const out = planClaimAttributeWrites({
      claims: {},
      mapping: { map: [{ claimPath: 'dept', attributeKey: 'department' }] },
      existing: {},
      definitions: defs,
    })
    expect(out).toEqual({ valid: {}, removals: [] })
    expect(out).not.toHaveProperty('skips')
  })
})
