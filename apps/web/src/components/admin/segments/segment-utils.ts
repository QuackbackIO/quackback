import { CUSTOM_ATTR_PREFIX } from '@/components/admin/segments/segment-form'
import type { RuleCondition } from '@/components/admin/segments/segment-form'
import type { UserAttributeItem } from '@/lib/client/hooks/use-user-attributes-queries'
import type { SegmentCondition } from '@/lib/shared/db-types'

export const SEGMENT_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#6b7280',
]

export function getAutoColor(index: number): string {
  return SEGMENT_COLORS[index % SEGMENT_COLORS.length]
}

function parseConditionValue(
  attribute: string,
  value: string,
  operator?: string,
  customAttributes?: UserAttributeItem[]
): string | number | boolean | undefined {
  if (operator === 'is_set' || operator === 'is_not_set') return undefined
  if (attribute.startsWith(CUSTOM_ATTR_PREFIX) && customAttributes) {
    const key = attribute.slice(CUSTOM_ATTR_PREFIX.length)
    const attr = customAttributes.find((a) => a.key === key)
    if (attr) {
      if (attr.type === 'number' || attr.type === 'currency') return Number(value) || 0
      if (attr.type === 'boolean') return value === 'true'
    }
    return value
  }
  const numericAttributes = ['created_at_days_ago', 'post_count', 'vote_count', 'comment_count']
  if (numericAttributes.includes(attribute)) return Number(value) || 0
  if (attribute === 'email_verified') return value === 'true'
  return value
}

export function serializeCondition(
  c: RuleCondition,
  customAttributes?: UserAttributeItem[]
): {
  attribute: string
  operator: string
  value?: string | number | boolean
  metadataKey?: string
} {
  if (c.attribute.startsWith(CUSTOM_ATTR_PREFIX)) {
    const key = c.attribute.slice(CUSTOM_ATTR_PREFIX.length)
    return {
      attribute: 'metadata_key',
      operator: c.operator,
      value: parseConditionValue(c.attribute, c.value, c.operator, customAttributes),
      metadataKey: key,
    }
  }
  return {
    attribute: c.attribute,
    operator: c.operator,
    value: parseConditionValue(c.attribute, c.value, c.operator, customAttributes),
    metadataKey: c.metadataKey,
  }
}

export function deserializeCondition(
  c: SegmentCondition,
  customAttributes?: UserAttributeItem[]
): { attribute: string; operator: string; value: string; metadataKey?: string } {
  if (c.attribute === 'metadata_key' && c.metadataKey && customAttributes) {
    const known = customAttributes.find((a) => a.key === c.metadataKey)
    if (known) {
      return {
        attribute: `${CUSTOM_ATTR_PREFIX}${c.metadataKey}`,
        operator: c.operator as string,
        value: c.value != null ? String(c.value) : '',
        metadataKey: c.metadataKey,
      }
    }
  }
  return {
    attribute: c.attribute as string,
    operator: c.operator as string,
    value: c.value != null ? String(c.value) : '',
    metadataKey: c.metadataKey,
  }
}
