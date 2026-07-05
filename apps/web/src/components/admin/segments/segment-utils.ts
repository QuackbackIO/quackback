import { CUSTOM_ATTR_PREFIX, COMPANY_ATTR_PREFIX } from '@/components/admin/segments/segment-form'
import type { RuleCondition } from '@/components/admin/segments/segment-form'
import type { UserAttributeItem } from '@/lib/client/hooks/use-user-attributes-queries'
import type { CompanyAttributeItem } from '@/lib/client/hooks/use-company-attributes-queries'
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

function typedAttrValue(
  key: string,
  value: string,
  defs?: { key: string; type: string }[]
): string | number | boolean {
  const attr = defs?.find((a) => a.key === key)
  if (attr) {
    if (attr.type === 'number' || attr.type === 'currency') return Number(value) || 0
    if (attr.type === 'boolean') return value === 'true'
  }
  return value
}

function parseConditionValue(
  attribute: string,
  value: string,
  operator?: string,
  customAttributes?: UserAttributeItem[],
  companyAttributes?: CompanyAttributeItem[]
): string | number | boolean | undefined {
  if (operator === 'is_set' || operator === 'is_not_set') return undefined
  if (attribute.startsWith(CUSTOM_ATTR_PREFIX)) {
    return typedAttrValue(attribute.slice(CUSTOM_ATTR_PREFIX.length), value, customAttributes)
  }
  if (attribute.startsWith(COMPANY_ATTR_PREFIX)) {
    return typedAttrValue(attribute.slice(COMPANY_ATTR_PREFIX.length), value, companyAttributes)
  }
  const numericAttributes = [
    'created_at_days_ago',
    'post_count',
    'vote_count',
    'comment_count',
    'company_mrr',
  ]
  if (numericAttributes.includes(attribute)) return Number(value) || 0
  if (attribute === 'email_verified') return value === 'true'
  return value
}

export function serializeCondition(
  c: RuleCondition,
  customAttributes?: UserAttributeItem[],
  companyAttributes?: CompanyAttributeItem[]
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
  if (c.attribute.startsWith(COMPANY_ATTR_PREFIX)) {
    const key = c.attribute.slice(COMPANY_ATTR_PREFIX.length)
    return {
      attribute: 'company_attr',
      operator: c.operator,
      value: parseConditionValue(c.attribute, c.value, c.operator, undefined, companyAttributes),
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
  customAttributes?: UserAttributeItem[],
  companyAttributes?: CompanyAttributeItem[]
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
  if (c.attribute === 'company_attr' && c.metadataKey && companyAttributes) {
    const known = companyAttributes.find((a) => a.key === c.metadataKey)
    if (known) {
      return {
        attribute: `${COMPANY_ATTR_PREFIX}${c.metadataKey}`,
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
