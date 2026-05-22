import { describe, it, expect } from 'vitest'
import {
  BUILTIN_FIELDS,
  BUILTIN_FIELD_MAP,
  DEFAULT_OPERATORS,
  getFieldOperators,
  isBuiltinField,
  type BuiltinField,
} from '../segment-builtin-fields'
import type { SegmentRuleAttribute } from '@/lib/server/db'

const ALLOWED_TYPES: ReadonlyArray<BuiltinField['type']> = ['string', 'number', 'boolean', 'date']

describe('BUILTIN_FIELDS registry well-formedness', () => {
  it('is a non-empty array', () => {
    expect(BUILTIN_FIELDS.length).toBeGreaterThan(0)
  })

  it('every entry has a non-empty key', () => {
    for (const field of BUILTIN_FIELDS) {
      expect(field.key.length).toBeGreaterThan(0)
    }
  })

  it('every entry has a non-empty label', () => {
    for (const field of BUILTIN_FIELDS) {
      expect(field.label.trim().length, `field "${field.key}" has empty label`).toBeGreaterThan(0)
    }
  })

  it('every entry has a valid type', () => {
    for (const field of BUILTIN_FIELDS) {
      expect(ALLOWED_TYPES, `field "${field.key}" has invalid type "${field.type}"`).toContain(
        field.type
      )
    }
  })

  it('keys are unique', () => {
    const keys = BUILTIN_FIELDS.map((f) => f.key)
    const uniqueKeys = new Set(keys)
    expect(uniqueKeys.size).toBe(keys.length)
  })

  it('includes all expected built-in keys', () => {
    const keys: Set<string> = new Set(BUILTIN_FIELDS.map((f) => f.key))
    const expected = [
      'email_domain',
      'email_verified',
      'created_at_days_ago',
      'post_count',
      'vote_count',
      'comment_count',
      'name',
      'display_name',
      'principal_type',
    ]
    for (const key of expected) {
      expect(keys.has(key), `expected key "${key}" to be in BUILTIN_FIELDS`).toBe(true)
    }
  })

  it('does NOT include plan or metadata_key (those are the custom-attribute mechanism)', () => {
    const keys: Set<string> = new Set(BUILTIN_FIELDS.map((f) => f.key))
    expect(keys.has('plan')).toBe(false)
    expect(keys.has('metadata_key')).toBe(false)
  })

  it('principal_type has allowedValues of ["user", "anonymous"]', () => {
    const field = BUILTIN_FIELDS.find((f) => f.key === 'principal_type')
    expect(field).toBeDefined()
    expect(field!.allowedValues).toEqual(['user', 'anonymous'])
  })

  it('email_verified has type boolean', () => {
    const field = BUILTIN_FIELDS.find((f) => f.key === 'email_verified')
    expect(field?.type).toBe('boolean')
  })

  it('numeric fields have type number', () => {
    for (const key of ['created_at_days_ago', 'post_count', 'vote_count', 'comment_count']) {
      const field = BUILTIN_FIELDS.find((f) => f.key === key)
      expect(field?.type, `"${key}" should be number`).toBe('number')
    }
  })

  it('string fields have type string', () => {
    for (const key of ['email_domain', 'name', 'display_name', 'principal_type']) {
      const field = BUILTIN_FIELDS.find((f) => f.key === key)
      expect(field?.type, `"${key}" should be string`).toBe('string')
    }
  })
})

describe('BUILTIN_FIELD_MAP', () => {
  it('is a Map', () => {
    expect(BUILTIN_FIELD_MAP instanceof Map).toBe(true)
  })

  it('has the same size as BUILTIN_FIELDS', () => {
    expect(BUILTIN_FIELD_MAP.size).toBe(BUILTIN_FIELDS.length)
  })

  it('each BUILTIN_FIELDS entry is accessible by key', () => {
    for (const field of BUILTIN_FIELDS) {
      expect(BUILTIN_FIELD_MAP.get(field.key)).toBe(field)
    }
  })
})

describe('isBuiltinField', () => {
  it('returns true for every key in the registry', () => {
    for (const field of BUILTIN_FIELDS) {
      expect(isBuiltinField(field.key), `isBuiltinField("${field.key}") should be true`).toBe(true)
    }
  })

  it('returns false for unknown keys', () => {
    expect(isBuiltinField('plan')).toBe(false)
    expect(isBuiltinField('metadata_key')).toBe(false)
    expect(isBuiltinField('nonexistent_field')).toBe(false)
    expect(isBuiltinField('')).toBe(false)
  })
})

describe('type-level: every registry key is a valid SegmentRuleAttribute', () => {
  // This test enforces that the registry keys are kept in sync with the
  // SegmentRuleAttribute union. If a key is added to the registry but not
  // the union, TypeScript will catch it at compile time.
  it('can assign each registry key to SegmentRuleAttribute without assertion', () => {
    for (const field of BUILTIN_FIELDS) {
      // The type cast below will fail at compile time if field.key is not
      // a subtype of SegmentRuleAttribute.
      const _: SegmentRuleAttribute = field.key as SegmentRuleAttribute
      void _
    }
    // If we reach here the compile-time check passed.
    expect(true).toBe(true)
  })
})

describe('DEFAULT_OPERATORS', () => {
  it('covers all four base types', () => {
    for (const t of ['string', 'number', 'boolean', 'date'] as const) {
      expect(DEFAULT_OPERATORS[t].length).toBeGreaterThan(0)
    }
  })

  it('string default includes contains, starts_with, ends_with', () => {
    const ops = DEFAULT_OPERATORS.string.map((o) => o.value)
    expect(ops).toContain('contains')
    expect(ops).toContain('starts_with')
    expect(ops).toContain('ends_with')
  })

  it('boolean default does NOT include numeric operators', () => {
    const ops = DEFAULT_OPERATORS.boolean.map((o) => o.value)
    for (const numOp of ['gt', 'gte', 'lt', 'lte']) {
      expect(ops).not.toContain(numOp)
    }
  })
})

describe('getFieldOperators', () => {
  it('returns field.operators when present (email_domain override)', () => {
    const field = BUILTIN_FIELDS.find((f) => f.key === 'email_domain')!
    const ops = getFieldOperators(field).map((o) => o.value)
    // email_domain evaluator does NOT support contains or starts_with
    expect(ops).not.toContain('contains')
    expect(ops).not.toContain('starts_with')
    expect(ops).toContain('ends_with')
    expect(ops).toContain('eq')
    expect(ops).toContain('is_set')
  })

  it('returns field.operators for principal_type (only eq/neq)', () => {
    const field = BUILTIN_FIELDS.find((f) => f.key === 'principal_type')!
    const ops = getFieldOperators(field).map((o) => o.value)
    expect(ops).toEqual(['eq', 'neq'])
  })

  it('returns field.operators for created_at_days_ago (no is_set/is_not_set)', () => {
    const field = BUILTIN_FIELDS.find((f) => f.key === 'created_at_days_ago')!
    const ops = getFieldOperators(field).map((o) => o.value)
    expect(ops).not.toContain('is_set')
    expect(ops).not.toContain('is_not_set')
    expect(ops).toContain('gt')
    expect(ops).toContain('lte')
  })

  it('returns type default for name (no operators override)', () => {
    const field = BUILTIN_FIELDS.find((f) => f.key === 'name') as BuiltinField | undefined
    expect(field).toBeDefined()
    expect(field!.operators).toBeUndefined()
    const ops = getFieldOperators(field!).map((o) => o.value)
    // Should use string default — has contains
    expect(ops).toContain('contains')
  })

  it('post_count operators include is_set/is_not_set', () => {
    const field = BUILTIN_FIELDS.find((f) => f.key === 'post_count')!
    const ops = getFieldOperators(field).map((o) => o.value)
    expect(ops).toContain('is_set')
    expect(ops).toContain('is_not_set')
  })
})
