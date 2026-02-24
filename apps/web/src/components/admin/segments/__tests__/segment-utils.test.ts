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
