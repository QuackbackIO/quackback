/**
 * Real-DB coverage for the qualification flow (§K2): committing a company name
 * from the inbox sidebar creates-or-attaches by case-insensitive name match,
 * with `source: 'manual'` on create. One record type — no shadow
 * "qualification company" object.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type TypeId, type UserId } from '@quackback/ids'

type CompanyId = TypeId<'company'>
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { companies, principal, user, eq } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createCompany, getForPrincipal, qualifyCompany, updateCompany } from '../company.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    // The qualification fields shipped in migration 0157.
    await db.select({ source: companies.source, size: companies.size }).from(companies).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Visitor' })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: 'Visitor',
    createdAt: new Date(),
  })
  return principalId
}

describe.skipIf(!fixture.available)('company qualification (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('creates a manual-source company with the qualification fields and attaches the person', async () => {
    const principalId = await seedPrincipal()
    const name = `Fresh Co ${suffix()}`

    const company = await qualifyCompany({
      principalId,
      name,
      size: '11-50',
      website: 'https://fresh.example',
      industry: 'SaaS',
    })

    expect(company.name).toBe(name)
    expect(company.source).toBe('manual')
    expect(company.size).toBe('11-50')
    expect(company.website).toBe('https://fresh.example')
    expect(company.industry).toBe('SaaS')

    const attached = await getForPrincipal(principalId)
    expect(attached?.id).toBe(company.id)
  })

  it('attaches to an existing company by case-insensitive name match instead of duplicating', async () => {
    const principalId = await seedPrincipal()
    const name = `Existing Co ${suffix()}`
    const existing = await createCompany({ name })

    const company = await qualifyCompany({ principalId, name: name.toUpperCase() })

    expect(company.id).toBe(existing.id)
    // The matched record keeps its original source.
    expect(company.source).toBe('api')

    const attached = await getForPrincipal(principalId)
    expect(attached?.id).toBe(existing.id)
  })

  it('writes provided qualification fields through to the matched company (global edits)', async () => {
    const principalId = await seedPrincipal()
    const name = `Enrich Co ${suffix()}`
    const existing = await createCompany({ name })

    const company = await qualifyCompany({ principalId, name, size: '51-200' })

    expect(company.id).toBe(existing.id)
    expect(company.size).toBe('51-200')
  })

  it('does not blank existing fields when the agent leaves them empty', async () => {
    const principalId = await seedPrincipal()
    const name = `Keep Co ${suffix()}`
    const existing = await createCompany({ name })
    await updateCompany(existing.id as CompanyId, { industry: 'Fintech' })

    const company = await qualifyCompany({ principalId, name })
    expect(company.industry).toBe('Fintech')
  })

  it('rejects an empty name', async () => {
    const principalId = await seedPrincipal()
    await expect(qualifyCompany({ principalId, name: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  it('re-points a person who already had a company', async () => {
    const principalId = await seedPrincipal()
    const first = await createCompany({ name: `First ${suffix()}` })
    await testDb
      .update(principal)
      .set({ companyId: first.id as CompanyId })
      .where(eq(principal.id, principalId))

    const next = await qualifyCompany({ principalId, name: `Second ${suffix()}` })
    const attached = await getForPrincipal(principalId)
    expect(attached?.id).toBe(next.id)
  })
})
