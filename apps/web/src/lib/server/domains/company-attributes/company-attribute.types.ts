import type { CompanyAttributeId } from '@quackback/ids'
import type { UserAttributeType, CurrencyCode } from '@/lib/server/db'

export interface CompanyAttribute {
  id: CompanyAttributeId
  key: string
  label: string
  description: string | null
  type: UserAttributeType
  currencyCode: CurrencyCode | null
  /** External key for CRM/CDP attribute mapping. Falls back to `key` if null. */
  externalKey: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateCompanyAttributeInput {
  key: string
  label: string
  description?: string | null
  type: UserAttributeType
  currencyCode?: CurrencyCode | null
  externalKey?: string | null
}

export interface UpdateCompanyAttributeInput {
  label?: string
  description?: string | null
  type?: UserAttributeType
  currencyCode?: CurrencyCode | null
  externalKey?: string | null
}
