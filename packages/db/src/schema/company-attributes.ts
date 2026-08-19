/**
 * Company Attribute Definitions schema
 *
 * Admin-defined custom attributes that map to keys in companies.custom_attributes
 * (JSONB). Mirrors user_attribute_definitions exactly: these appear as
 * first-class company predicates in the segment rule builder and as typed
 * editors on the company profile.
 */
import { pgTable, text, timestamp, uniqueIndex, customType } from 'drizzle-orm/pg-core'
import { generateId, toUuid, fromUuid, isUuid, type TypeId } from '@quackback/ids'
import type { UserAttributeType, CurrencyCode } from './user-attributes'

/**
 * TypeID column stored as `text` holding the UUID form — cloned from the
 * user_attr column so the two definition tables stay structurally identical
 * (see user-attributes.ts for why the id is text rather than uuid).
 */
const companyAttrIdText = customType<{ data: TypeId<'company_attr'>; driverData: string }>({
  dataType() {
    return 'text'
  },
  toDriver(value: TypeId<'company_attr'>): string {
    return isUuid(value) ? value : toUuid(value)
  },
  fromDriver(value: unknown): TypeId<'company_attr'> {
    if (typeof value !== 'string') {
      throw new Error(`Expected string from database, got ${typeof value}`)
    }
    return fromUuid('company_attr', value)
  },
})

export const companyAttributeDefinitions = pgTable(
  'company_attribute_definitions',
  {
    id: companyAttrIdText('id')
      .primaryKey()
      .$defaultFn(() => generateId('company_attr')),
    /** The JSON key inside companies.custom_attributes, e.g. "region", "seats" */
    key: text('key').notNull(),
    /** Human-readable label shown in the UI, e.g. "Contract value" */
    label: text('label').notNull(),
    /** Optional description / help text */
    description: text('description'),
    /** Data type — controls available operators and value input in segment builder */
    type: text('type', {
      enum: ['string', 'number', 'boolean', 'date', 'currency'],
    })
      .notNull()
      .$type<UserAttributeType>(),
    /** ISO 4217 code — only populated when type = 'currency' */
    currencyCode: text('currency_code').$type<CurrencyCode | null>(),
    /**
     * Optional external key for CRM/CDP integrations. When set, the inbound
     * handler maps this external name → the internal `key`. Falls back to
     * `key` if not provided.
     */
    externalKey: text('external_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex('company_attr_key_idx').on(t.key)]
)
