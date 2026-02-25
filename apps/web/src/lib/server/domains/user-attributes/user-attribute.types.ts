import type { UserAttributeId } from '@quackback/ids'
import type { UserAttributeType, CurrencyCode } from '@/lib/server/db'

export interface UserAttribute {
  id: UserAttributeId
  key: string
  label: string
  description: string | null
  type: UserAttributeType
  currencyCode: CurrencyCode | null
  /** External key for CDP attribute mapping (e.g. Segment attribute name). Falls back to `key` if null. */
  externalKey: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateUserAttributeInput {
  key: string
  label: string
  description?: string | null
  type: UserAttributeType
  currencyCode?: CurrencyCode | null
  externalKey?: string | null
}

export interface UpdateUserAttributeInput {
  label?: string
  description?: string | null
  type?: UserAttributeType
  currencyCode?: CurrencyCode | null
  externalKey?: string | null
}
