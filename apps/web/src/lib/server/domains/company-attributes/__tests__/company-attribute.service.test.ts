/**
 * Real-DB coverage for company attribute definitions (migration 0157): CRUD,
 * key normalization, the unique key index, and the text-typeid id round-trip.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createDbTestFixture } from '@/lib/server/__tests__/db-test-fixture'
import { companyAttributeDefinitions } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  listCompanyAttributes,
  createCompanyAttribute,
  updateCompanyAttribute,
  deleteCompanyAttribute,
} from '../company-attribute.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: companyAttributeDefinitions.id }).from(companyAttributeDefinitions).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

describe.skipIf(!fixture.available)('company-attribute.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('creates, lists, updates, and deletes a definition', async () => {
    const key = `region_${suffix()}`
    const created = await createCompanyAttribute({ key, label: 'Region', type: 'string' })
    expect(created.id.startsWith('company_attr_')).toBe(true)
    expect(created.key).toBe(key)

    const listed = await listCompanyAttributes()
    expect(listed.map((a) => a.id)).toContain(created.id)

    const updated = await updateCompanyAttribute(created.id, { label: 'Sales region' })
    expect(updated.label).toBe('Sales region')

    await deleteCompanyAttribute(created.id)
    const after = await listCompanyAttributes()
    expect(after.map((a) => a.id)).not.toContain(created.id)
  })

  it('normalizes keys and requires a currency code for currency attributes', async () => {
    const raw = `Contract Value ${suffix()}`
    const created = await createCompanyAttribute({
      key: raw,
      label: 'Contract value',
      type: 'currency',
      currencyCode: 'USD',
    })
    expect(created.key).toBe(raw.toLowerCase().replace(/\s+/g, '_'))
    expect(created.currencyCode).toBe('USD')

    await expect(
      createCompanyAttribute({ key: `acv_${suffix()}`, label: 'ACV', type: 'currency' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('rejects a duplicate key', async () => {
    const key = `dup_${suffix()}`
    await createCompanyAttribute({ key, label: 'First', type: 'string' })
    await expect(
      createCompanyAttribute({ key, label: 'Second', type: 'number' })
    ).rejects.toMatchObject({ code: 'DUPLICATE_KEY' })
  })

  it('clears the currency code when switching away from currency', async () => {
    const created = await createCompanyAttribute({
      key: `spend_${suffix()}`,
      label: 'Spend',
      type: 'currency',
      currencyCode: 'EUR',
    })
    const updated = await updateCompanyAttribute(created.id, { type: 'number' })
    expect(updated.type).toBe('number')
    expect(updated.currencyCode).toBeNull()
  })
})
