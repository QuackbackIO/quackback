import { describe, it, expect } from 'vitest'
import {
  readAttributeValue,
  attributeHasValue,
  missingRequiredAttributes,
} from '../attribute-values'

describe('readAttributeValue', () => {
  it('unwraps a { v, src, at } envelope', () => {
    const read = readAttributeValue({ v: 'pro', src: 'teammate', at: '2026-07-05T00:00:00.000Z' })
    expect(read).toEqual({ v: 'pro', src: 'teammate', at: '2026-07-05T00:00:00.000Z' })
  })

  it('accepts a bare legacy value with no provenance', () => {
    expect(readAttributeValue('billing issue')).toEqual({ v: 'billing issue', src: null, at: null })
    expect(readAttributeValue(42)).toEqual({ v: 42, src: null, at: null })
    expect(readAttributeValue(true)).toEqual({ v: true, src: null, at: null })
  })

  it('treats an object without a v key as a bare legacy value', () => {
    const legacy = { nested: 'shape' }
    expect(readAttributeValue(legacy)).toEqual({ v: legacy, src: null, at: null })
  })

  it('treats an envelope with an unknown src as legacy (no provenance trusted)', () => {
    const odd = { v: 'x', src: 'martian', at: 'nope' }
    expect(readAttributeValue(odd)).toEqual({ v: odd, src: null, at: null })
  })

  it('returns null for an unset key', () => {
    expect(readAttributeValue(undefined)).toBeNull()
  })
})

describe('attributeHasValue', () => {
  it('is false for unset, null, empty string, and empty array', () => {
    expect(attributeHasValue(undefined)).toBe(false)
    expect(attributeHasValue({ v: null, src: 'teammate', at: 'x' })).toBe(false)
    expect(attributeHasValue({ v: '', src: 'teammate', at: 'x' })).toBe(false)
    expect(attributeHasValue({ v: [], src: 'teammate', at: 'x' })).toBe(false)
  })

  it('is true for real values including false and 0', () => {
    expect(attributeHasValue({ v: false, src: 'teammate', at: 'x' })).toBe(true)
    expect(attributeHasValue({ v: 0, src: 'workflow', at: 'x' })).toBe(true)
    expect(attributeHasValue('legacy')).toBe(true)
  })
})

describe('missingRequiredAttributes', () => {
  const defs = [
    { key: 'plan', label: 'Plan', requiredToClose: true, archivedAt: null },
    { key: 'region', label: 'Region', requiredToClose: false, archivedAt: null },
    { key: 'tier', label: 'Tier', requiredToClose: true, archivedAt: new Date() },
  ]

  it('lists required, unfilled, non-archived definitions', () => {
    expect(missingRequiredAttributes(defs, {})).toEqual([{ key: 'plan', label: 'Plan' }])
  })

  it('is empty when the required attribute is filled (envelope or legacy)', () => {
    expect(
      missingRequiredAttributes(defs, { plan: { v: 'pro', src: 'teammate', at: 'x' } })
    ).toEqual([])
    expect(missingRequiredAttributes(defs, { plan: 'legacy-pro' })).toEqual([])
  })

  it('ignores archived required definitions (they are hidden from editors)', () => {
    // 'tier' is required but archived: it must never block a close.
    expect(missingRequiredAttributes(defs, { plan: { v: 'pro', src: 'ai', at: 'x' } })).toEqual([])
  })
})
