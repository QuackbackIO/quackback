/**
 * Parity coverage for the generic attribute-definition service: the user and
 * company wrappers share one implementation, so validation, key
 * normalization, and error codes must behave identically — differing only in
 * the entity name carried in messages and the id prefix minted.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createDbTestFixture } from '@/lib/server/__tests__/db-test-fixture'
import { userAttributeDefinitions, companyAttributeDefinitions } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  listUserAttributes,
  createUserAttribute,
  deleteUserAttribute,
} from '@/lib/server/domains/user-attributes/user-attribute.service'
import {
  listCompanyAttributes,
  createCompanyAttribute,
  updateCompanyAttribute,
  deleteCompanyAttribute,
} from '@/lib/server/domains/company-attributes/company-attribute.service'
import { normalizeAttributeKey } from '@/lib/server/domains/attribute-definitions/attribute-definition.service'
import { createId } from '@quackback/ids'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: userAttributeDefinitions.id }).from(userAttributeDefinitions).limit(0)
    await db
      .select({ id: companyAttributeDefinitions.id })
      .from(companyAttributeDefinitions)
      .limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

describe('normalizeAttributeKey', () => {
  it('trims, lowercases, and underscorizes whitespace', () => {
    expect(normalizeAttributeKey('  Contract Value ')).toBe('contract_value')
  })
})

describe.skipIf(!fixture.available)('user/company attribute parity (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('mints distinct id prefixes per domain', async () => {
    const user = await createUserAttribute({ key: `u_${suffix()}`, label: 'U', type: 'string' })
    const company = await createCompanyAttribute({
      key: `c_${suffix()}`,
      label: 'C',
      type: 'string',
    })
    expect(user.id.startsWith('user_attr_')).toBe(true)
    expect(company.id.startsWith('company_attr_')).toBe(true)
  })

  it('rejects missing key/label/currency with identical codes', async () => {
    for (const create of [createUserAttribute, createCompanyAttribute]) {
      await expect(create({ key: '  ', label: 'X', type: 'string' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      })
      await expect(
        create({ key: `k_${suffix()}`, label: '  ', type: 'string' })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
      await expect(
        create({ key: `k_${suffix()}`, label: 'X', type: 'currency' })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    }
  })

  it('normalizes keys identically', async () => {
    const raw = `Parity Key ${suffix()}`
    const expected = raw.toLowerCase().replace(/\s+/g, '_')
    const user = await createUserAttribute({ key: raw, label: 'U', type: 'string' })
    const company = await createCompanyAttribute({ key: raw, label: 'C', type: 'string' })
    expect(user.key).toBe(expected)
    expect(company.key).toBe(expected)
  })

  it('names the entity in not-found errors', async () => {
    // Well-formed but never-created ids reach the not-found branch.
    const missingUser = createId('user_attr')
    const missingCompany = createId('company_attr')
    await expect(deleteUserAttribute(missingUser)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: expect.stringContaining('User attribute'),
    })
    await expect(deleteCompanyAttribute(missingCompany)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: expect.stringContaining('Company attribute'),
    })
  })

  it('clears the currency code when switching away from currency, in both domains', async () => {
    const company = await createCompanyAttribute({
      key: `spend_${suffix()}`,
      label: 'Spend',
      type: 'currency',
      currencyCode: 'EUR',
    })
    const updated = await updateCompanyAttribute(company.id, { type: 'number' })
    expect(updated.currencyCode).toBeNull()
  })

  it('lists through the shared implementation', async () => {
    const key = `listed_${suffix()}`
    await createUserAttribute({ key, label: 'Listed', type: 'string' })
    expect((await listUserAttributes()).map((a) => a.key)).toContain(key)
    expect((await listCompanyAttributes()).map((a) => a.key)).not.toContain(key)
  })
})
