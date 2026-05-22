/**
 * Tests for segment-utils.ts
 *
 * Covers:
 * - getAutoColor: auto-color cycling
 * - serializeCondition: form → DB format (built-in + custom attrs)
 * - deserializeCondition: DB → form format (built-in + custom attrs)
 */

import { describe, it, expect } from 'vitest'
import {
  SEGMENT_COLORS,
  getAutoColor,
  serializeCondition,
  deserializeCondition,
} from '../segment-utils'
import type { RuleCondition } from '../segment-form'
import type { SegmentCondition } from '@/lib/shared/db-types'
import type { UserAttributeItem } from '@/lib/client/hooks/use-user-attributes-queries'

const CUSTOM_ATTR_PREFIX = '__custom__'

function mockAttr(
  overrides: Partial<UserAttributeItem> & { key: string; type: string }
): UserAttributeItem {
  return {
    id: `attr_${overrides.key}`,
    label: overrides.key,
    description: null,
    externalKey: null,
    currencyCode: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  } as UserAttributeItem
}

const mockCustomAttributes: UserAttributeItem[] = [
  mockAttr({ key: 'plan', type: 'string' }),
  mockAttr({ key: 'mrr', type: 'number' }),
  mockAttr({ key: 'active', type: 'boolean' }),
  mockAttr({ key: 'revenue', type: 'currency' }),
]

// ============================================
// getAutoColor
// ============================================

describe('getAutoColor', () => {
  it('should return the first color for index 0', () => {
    expect(getAutoColor(0)).toBe(SEGMENT_COLORS[0])
  })

  it('should return sequential colors', () => {
    for (let i = 0; i < SEGMENT_COLORS.length; i++) {
      expect(getAutoColor(i)).toBe(SEGMENT_COLORS[i])
    }
  })

  it('should cycle back to the beginning after exhausting all colors', () => {
    expect(getAutoColor(SEGMENT_COLORS.length)).toBe(SEGMENT_COLORS[0])
    expect(getAutoColor(SEGMENT_COLORS.length + 1)).toBe(SEGMENT_COLORS[1])
  })

  it('should handle large indices', () => {
    const index = 1000
    expect(getAutoColor(index)).toBe(SEGMENT_COLORS[index % SEGMENT_COLORS.length])
  })
})

// ============================================
// serializeCondition
// ============================================

describe('serializeCondition', () => {
  it('should serialize a built-in string condition', () => {
    const condition: RuleCondition = {
      attribute: 'email_domain',
      operator: 'eq',
      value: 'example.com',
    }
    const result = serializeCondition(condition)
    expect(result).toEqual({
      attribute: 'email_domain',
      operator: 'eq',
      value: 'example.com',
      metadataKey: undefined,
    })
  })

  it('should serialize a boolean attribute', () => {
    const condition: RuleCondition = {
      attribute: 'email_verified',
      operator: 'eq',
      value: 'true',
    }
    const result = serializeCondition(condition)
    expect(result.value).toBe(true)
  })

  it('should serialize numeric attributes', () => {
    const condition: RuleCondition = {
      attribute: 'post_count',
      operator: 'gte',
      value: '10',
    }
    const result = serializeCondition(condition)
    expect(result.value).toBe(10)
  })

  it('should serialize created_at_days_ago as numeric', () => {
    const condition: RuleCondition = {
      attribute: 'created_at_days_ago',
      operator: 'lte',
      value: '30',
    }
    const result = serializeCondition(condition)
    expect(result.value).toBe(30)
  })

  it('should serialize is_set operator without value', () => {
    const condition: RuleCondition = {
      attribute: 'email_domain',
      operator: 'is_set',
      value: '',
    }
    const result = serializeCondition(condition)
    expect(result.value).toBeUndefined()
  })

  it('should serialize is_not_set operator without value', () => {
    const condition: RuleCondition = {
      attribute: 'email_domain',
      operator: 'is_not_set',
      value: '',
    }
    const result = serializeCondition(condition)
    expect(result.value).toBeUndefined()
  })

  it('should serialize a custom attribute as metadata_key', () => {
    const condition: RuleCondition = {
      attribute: `${CUSTOM_ATTR_PREFIX}plan`,
      operator: 'eq',
      value: 'enterprise',
    }
    const result = serializeCondition(condition, mockCustomAttributes)
    expect(result).toEqual({
      attribute: 'metadata_key',
      operator: 'eq',
      value: 'enterprise',
      metadataKey: 'plan',
    })
  })

  it('should serialize a custom number attribute with correct type', () => {
    const condition: RuleCondition = {
      attribute: `${CUSTOM_ATTR_PREFIX}mrr`,
      operator: 'gte',
      value: '500',
    }
    const result = serializeCondition(condition, mockCustomAttributes)
    expect(result.attribute).toBe('metadata_key')
    expect(result.metadataKey).toBe('mrr')
    expect(result.value).toBe(500)
  })

  it('should serialize a custom boolean attribute with correct type', () => {
    const condition: RuleCondition = {
      attribute: `${CUSTOM_ATTR_PREFIX}active`,
      operator: 'eq',
      value: 'true',
    }
    const result = serializeCondition(condition, mockCustomAttributes)
    expect(result.value).toBe(true)
  })

  it('should serialize a custom currency attribute as number', () => {
    const condition: RuleCondition = {
      attribute: `${CUSTOM_ATTR_PREFIX}revenue`,
      operator: 'gt',
      value: '1000',
    }
    const result = serializeCondition(condition, mockCustomAttributes)
    expect(result.value).toBe(1000)
  })

  it('should preserve metadataKey for non-custom attributes', () => {
    const condition: RuleCondition = {
      attribute: 'email_domain',
      operator: 'eq',
      value: 'test.com',
      metadataKey: 'some_key',
    }
    const result = serializeCondition(condition)
    expect(result.metadataKey).toBe('some_key')
  })
})

// ============================================
// deserializeCondition
// ============================================

describe('deserializeCondition', () => {
  it('should deserialize a built-in condition', () => {
    const condition: SegmentCondition = {
      attribute: 'email_domain',
      operator: 'eq',
      value: 'example.com',
    }
    const result = deserializeCondition(condition)
    expect(result).toEqual({
      attribute: 'email_domain',
      operator: 'eq',
      value: 'example.com',
      metadataKey: undefined,
    })
  })

  it('should deserialize a metadata_key condition to custom attr prefix', () => {
    const condition: SegmentCondition = {
      attribute: 'metadata_key',
      operator: 'eq',
      value: 'enterprise',
      metadataKey: 'plan',
    }
    const result = deserializeCondition(condition, mockCustomAttributes)
    expect(result.attribute).toBe(`${CUSTOM_ATTR_PREFIX}plan`)
    expect(result.value).toBe('enterprise')
    expect(result.metadataKey).toBe('plan')
  })

  it('should fall back to raw attribute when custom attr not found in definitions', () => {
    const condition: SegmentCondition = {
      attribute: 'metadata_key',
      operator: 'eq',
      value: 'test',
      metadataKey: 'unknown_attr',
    }
    const result = deserializeCondition(condition, mockCustomAttributes)
    // Falls through because 'unknown_attr' is not in mockCustomAttributes
    expect(result.attribute).toBe('metadata_key')
    expect(result.metadataKey).toBe('unknown_attr')
  })

  it('should handle null/undefined values as empty string', () => {
    const condition: SegmentCondition = {
      attribute: 'email_domain',
      operator: 'is_set',
    }
    const result = deserializeCondition(condition)
    expect(result.value).toBe('')
  })

  it('should convert numeric values to strings', () => {
    const condition: SegmentCondition = {
      attribute: 'post_count',
      operator: 'gte',
      value: 10,
    }
    const result = deserializeCondition(condition)
    expect(result.value).toBe('10')
  })

  it('should convert boolean values to strings', () => {
    const condition: SegmentCondition = {
      attribute: 'email_verified',
      operator: 'eq',
      value: true,
    }
    const result = deserializeCondition(condition)
    expect(result.value).toBe('true')
  })

  it('should deserialize metadata_key without customAttributes gracefully', () => {
    const condition: SegmentCondition = {
      attribute: 'metadata_key',
      operator: 'eq',
      value: 'test',
      metadataKey: 'plan',
    }
    // No customAttributes provided
    const result = deserializeCondition(condition)
    expect(result.attribute).toBe('metadata_key')
    expect(result.metadataKey).toBe('plan')
  })
})

// ============================================
// Round-trip tests for new built-in fields (Task B)
// ============================================

describe('serializeCondition — new built-in fields round-trip', () => {
  it('serializes name as a plain string (un-prefixed)', () => {
    const c: RuleCondition = { attribute: 'name', operator: 'eq', value: 'Alice' }
    const s = serializeCondition(c)
    expect(s.attribute).toBe('name')
    expect(s.operator).toBe('eq')
    expect(s.value).toBe('Alice')
    expect(s.metadataKey).toBeUndefined()
  })

  it('serializes display_name as a plain string (un-prefixed)', () => {
    const c: RuleCondition = { attribute: 'display_name', operator: 'contains', value: 'Corp' }
    const s = serializeCondition(c)
    expect(s.attribute).toBe('display_name')
    expect(s.operator).toBe('contains')
    expect(s.value).toBe('Corp')
  })

  it('serializes principal_type as a plain string (un-prefixed)', () => {
    const c: RuleCondition = { attribute: 'principal_type', operator: 'eq', value: 'anonymous' }
    const s = serializeCondition(c)
    expect(s.attribute).toBe('principal_type')
    expect(s.value).toBe('anonymous')
  })

  it('name is_set produces undefined value', () => {
    const c: RuleCondition = { attribute: 'name', operator: 'is_set', value: '' }
    expect(serializeCondition(c).value).toBeUndefined()
  })
})

describe('deserializeCondition — new built-in fields round-trip', () => {
  it('deserializes name without prefixing', () => {
    const c: SegmentCondition = { attribute: 'name', operator: 'eq', value: 'Alice' }
    const d = deserializeCondition(c)
    expect(d.attribute).toBe('name')
    expect(d.value).toBe('Alice')
    expect(d.metadataKey).toBeUndefined()
  })

  it('deserializes display_name without prefixing', () => {
    const c: SegmentCondition = { attribute: 'display_name', operator: 'starts_with', value: 'Ac' }
    const d = deserializeCondition(c)
    expect(d.attribute).toBe('display_name')
    expect(d.value).toBe('Ac')
  })

  it('deserializes principal_type without prefixing', () => {
    const c: SegmentCondition = { attribute: 'principal_type', operator: 'eq', value: 'user' }
    const d = deserializeCondition(c)
    expect(d.attribute).toBe('principal_type')
    expect(d.value).toBe('user')
  })

  it('full round-trip: serialize then deserialize preserves name condition', () => {
    const original: RuleCondition = { attribute: 'name', operator: 'neq', value: 'Bot' }
    const serialized = serializeCondition(original)
    // Cast to SegmentCondition shape (value is string here)
    const deserialized = deserializeCondition(serialized as SegmentCondition)
    expect(deserialized.attribute).toBe('name')
    expect(deserialized.operator).toBe('neq')
    expect(deserialized.value).toBe('Bot')
  })

  it('full round-trip: serialize then deserialize preserves principal_type condition', () => {
    const original: RuleCondition = {
      attribute: 'principal_type',
      operator: 'eq',
      value: 'anonymous',
    }
    const serialized = serializeCondition(original)
    const deserialized = deserializeCondition(serialized as SegmentCondition)
    expect(deserialized.attribute).toBe('principal_type')
    expect(deserialized.value).toBe('anonymous')
  })
})

describe('backward compatibility — legacy attributes still deserialize', () => {
  it('deserializes a saved email_domain condition without error', () => {
    const c: SegmentCondition = {
      attribute: 'email_domain',
      operator: 'ends_with',
      value: 'acme.com',
    }
    const d = deserializeCondition(c)
    expect(d.attribute).toBe('email_domain')
    expect(d.value).toBe('acme.com')
  })

  it('deserializes a saved created_at_days_ago condition without error', () => {
    const c: SegmentCondition = { attribute: 'created_at_days_ago', operator: 'lt', value: 30 }
    const d = deserializeCondition(c)
    expect(d.attribute).toBe('created_at_days_ago')
    expect(d.value).toBe('30')
  })

  it('deserializes a saved plan condition without crashing (attribute passes through)', () => {
    // plan is no longer in the picker but old saved rules must not crash
    const c: SegmentCondition = { attribute: 'plan', operator: 'eq', value: 'enterprise' }
    const d = deserializeCondition(c)
    expect(d.attribute).toBe('plan')
    expect(d.value).toBe('enterprise')
  })

  it('deserializes a metadata_key condition with known custom attr', () => {
    const c: SegmentCondition = {
      attribute: 'metadata_key',
      operator: 'eq',
      value: 'enterprise',
      metadataKey: 'plan',
    }
    const d = deserializeCondition(c, mockCustomAttributes)
    expect(d.attribute).toBe(`${CUSTOM_ATTR_PREFIX}plan`)
    expect(d.metadataKey).toBe('plan')
  })

  it('deserializes a __custom__* condition attribute correctly', () => {
    const c: RuleCondition = {
      attribute: `${CUSTOM_ATTR_PREFIX}mrr`,
      operator: 'gte',
      value: '1000',
    }
    const s = serializeCondition(c, mockCustomAttributes)
    expect(s.attribute).toBe('metadata_key')
    expect(s.metadataKey).toBe('mrr')
    expect(s.value).toBe(1000)
  })
})
