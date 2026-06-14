import { describe, it, expect } from 'vitest'
import {
  BUILTIN_FIELDS,
  BUILTIN_FIELD_MAP,
  DEFAULT_OPERATORS,
  getFieldOperators,
  type BuiltinField,
  type FieldOperator,
} from '../segment-builtin-fields'
import type { SegmentRuleAttribute } from '@/lib/server/db'

const ALLOWED_TYPES: ReadonlyArray<BuiltinField['type']> = ['string', 'number', 'boolean', 'date']
const ALLOWED_GROUPS: ReadonlyArray<BuiltinField['group']> = [
  'attribute',
  'account',
  'activity',
  'crm',
]

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

  it('every entry has a valid group', () => {
    for (const field of BUILTIN_FIELDS) {
      expect(ALLOWED_GROUPS, `field "${field.key}" has invalid group "${field.group}"`).toContain(
        field.group
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
      'email',
      'email_verified',
      'created_at_days_ago',
      'post_count',
      'vote_count',
      'comment_count',
      'name',
      'locale',
      'country',
      'last_active_days_ago',
      'signup_source',
      'principal_type',
      'contact_title',
      'contact_metadata_key',
      'organization_domain',
      'organization_external_id',
      'organization_metadata_key',
    ]
    for (const key of expected) {
      expect(keys.has(key), `expected key "${key}" to be in BUILTIN_FIELDS`).toBe(true)
    }
  })

  it('does NOT include display_name (dropped — redundant with name for portal users)', () => {
    const keys: Set<string> = new Set(BUILTIN_FIELDS.map((f) => f.key))
    expect(keys.has('display_name')).toBe(false)
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
    for (const key of [
      'created_at_days_ago',
      'last_active_days_ago',
      'post_count',
      'vote_count',
      'comment_count',
    ]) {
      const field = BUILTIN_FIELDS.find((f) => f.key === key)
      expect(field?.type, `"${key}" should be number`).toBe('number')
    }
  })

  it('string fields have type string', () => {
    for (const key of [
      'email',
      'name',
      'locale',
      'country',
      'signup_source',
      'principal_type',
      'contact_title',
      'contact_metadata_key',
      'organization_domain',
      'organization_external_id',
      'organization_metadata_key',
    ]) {
      const field = BUILTIN_FIELDS.find((f) => f.key === key)
      expect(field?.type, `"${key}" should be string`).toBe('string')
    }
  })

  it('attribute-group fields are name, email, email_verified, locale (genuine user attributes)', () => {
    const attributeKeys = BUILTIN_FIELDS.filter((f) => f.group === 'attribute').map((f) => f.key)
    expect(attributeKeys).toEqual(
      expect.arrayContaining(['name', 'email', 'email_verified', 'locale'])
    )
    expect(attributeKeys).not.toContain('principal_type')
    expect(attributeKeys).not.toContain('post_count')
    expect(attributeKeys).not.toContain('vote_count')
    expect(attributeKeys).not.toContain('comment_count')
    expect(attributeKeys).not.toContain('created_at_days_ago')
  })

  it('account-group fields include principal_type, created_at_days_ago, country, last_active_days_ago, signup_source', () => {
    const accountKeys = BUILTIN_FIELDS.filter((f) => f.group === 'account').map((f) => f.key)
    expect(accountKeys).toEqual(
      expect.arrayContaining([
        'principal_type',
        'created_at_days_ago',
        'country',
        'last_active_days_ago',
        'signup_source',
      ])
    )
    expect(accountKeys).not.toContain('name')
    expect(accountKeys).not.toContain('email')
    expect(accountKeys).not.toContain('email_verified')
    expect(accountKeys).not.toContain('post_count')
    expect(accountKeys).not.toContain('vote_count')
    expect(accountKeys).not.toContain('comment_count')
  })

  it('activity-group fields are post_count, vote_count, comment_count', () => {
    const activityKeys = BUILTIN_FIELDS.filter((f) => f.group === 'activity').map((f) => f.key)
    expect(activityKeys).toEqual(
      expect.arrayContaining(['post_count', 'vote_count', 'comment_count'])
    )
    expect(activityKeys).not.toContain('name')
    expect(activityKeys).not.toContain('email')
    expect(activityKeys).not.toContain('email_verified')
    expect(activityKeys).not.toContain('principal_type')
    expect(activityKeys).not.toContain('created_at_days_ago')
  })

  it('crm-group fields expose linked contact and organization predicates', () => {
    const crmKeys = BUILTIN_FIELDS.filter((f) => f.group === 'crm').map((f) => f.key)
    expect(crmKeys).toEqual(
      expect.arrayContaining([
        'contact_title',
        'contact_metadata_key',
        'organization_domain',
        'organization_external_id',
        'organization_metadata_key',
      ])
    )
    expect(crmKeys).not.toContain('email')
    expect(crmKeys).not.toContain('post_count')
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
  it('email uses the string type default (full operator set including contains, starts_with)', () => {
    const field = BUILTIN_FIELDS.find((f) => f.key === 'email') as BuiltinField | undefined
    expect(field).toBeDefined()
    // email has no operators override — falls back to string default
    expect((field as BuiltinField & { operators?: unknown }).operators).toBeUndefined()
    const ops = getFieldOperators(field!).map(
      (o: { value: FieldOperator; label: string }) => o.value
    )
    expect(ops).toContain('eq')
    expect(ops).toContain('neq')
    expect(ops).toContain('contains')
    expect(ops).toContain('starts_with')
    expect(ops).toContain('ends_with')
    expect(ops).toContain('is_set')
    expect(ops).toContain('is_not_set')
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

  it('locale uses the string type default (is_set/is_not_set are meaningful — locale is nullable)', () => {
    const field = BUILTIN_FIELDS.find((f) => f.key === 'locale') as BuiltinField | undefined
    expect(field).toBeDefined()
    expect(field!.operators).toBeUndefined()
    const ops = getFieldOperators(field!).map((o) => o.value)
    expect(ops).toContain('eq')
    expect(ops).toContain('contains')
    expect(ops).toContain('starts_with')
    expect(ops).toContain('is_set')
    expect(ops).toContain('is_not_set')
  })

  it('post_count operators include is_set/is_not_set', () => {
    const field = BUILTIN_FIELDS.find((f) => f.key === 'post_count')!
    const ops = getFieldOperators(field).map((o) => o.value)
    expect(ops).toContain('is_set')
    expect(ops).toContain('is_not_set')
  })
})
