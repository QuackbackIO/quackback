import type { UserAttributeType, CurrencyCode } from '@/lib/server/db'

/**
 * Shared shape of user and company attribute definition rows. The two tables
 * differ only in their TypeID prefix (`user_attr_*` vs `company_attr_*`).
 */
export interface AttributeDefinitionRecord<TId extends string = string> {
  id: TId
  key: string
  label: string
  description: string | null
  type: UserAttributeType
  currencyCode: CurrencyCode | null
  /** External key for CDP/CRM mapping. Falls back to `key` if null. */
  externalKey: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateAttributeDefinitionInput {
  key: string
  label: string
  description?: string | null
  type: UserAttributeType
  currencyCode?: CurrencyCode | null
  externalKey?: string | null
}

export interface UpdateAttributeDefinitionInput {
  label?: string
  description?: string | null
  type?: UserAttributeType
  currencyCode?: CurrencyCode | null
  externalKey?: string | null
}
