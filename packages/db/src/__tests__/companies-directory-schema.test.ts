import { describe, it, expect } from 'vitest'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { companies } from '../schema/companies'
import { companyAttributeDefinitions } from '../schema/company-attributes'

describe('companies directory schema (migration 0157)', () => {
  describe('companies', () => {
    it('carries the qualification standard fields and the source discriminator', () => {
      const columns = Object.keys(getTableColumns(companies))
      expect(columns).toEqual(
        expect.arrayContaining([
          'id',
          'name',
          'domain',
          'externalId',
          'plan',
          'mrrCents',
          'size',
          'website',
          'industry',
          'source',
          'customAttributes',
          'createdAt',
          'updatedAt',
        ])
      )
      expect(columns.length).toBe(13)
    })

    it('source is NOT NULL with the api default (one record type, no shadow "qualification company")', () => {
      expect(companies.source.notNull).toBe(true)
      expect(companies.source.default).toBe('api')
    })
  })

  describe('companyAttributeDefinitions', () => {
    it('has correct table name', () => {
      expect(getTableName(companyAttributeDefinitions)).toBe('company_attribute_definitions')
    })

    it('mirrors user_attribute_definitions exactly', () => {
      const columns = Object.keys(getTableColumns(companyAttributeDefinitions))
      expect(columns).toEqual(
        expect.arrayContaining([
          'id',
          'key',
          'label',
          'description',
          'type',
          'currencyCode',
          'externalKey',
          'createdAt',
          'updatedAt',
        ])
      )
      expect(columns.length).toBe(9)
    })

    it('constrains type to the shared attribute type enum', () => {
      expect([...(companyAttributeDefinitions.type.enumValues ?? [])].sort()).toEqual(
        ['boolean', 'currency', 'date', 'number', 'string'].sort()
      )
    })
  })
})
