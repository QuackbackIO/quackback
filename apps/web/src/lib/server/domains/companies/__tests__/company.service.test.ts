/**
 * Real-DB coverage for the companies service: CRUD, the case-insensitive domain
 * / external-id unique indexes, and the person-to-company links. Runs inside the
 * db-test-fixture rollback transaction (see server/__tests__/README.md).
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

import {
  createCompany,
  updateCompany,
  deleteCompany,
  getCompany,
  listCompanies,
  getForPrincipal,
  attachPrincipal,
  detachPrincipal,
} from '../company.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: companies.id }).from(companies).limit(0)
    await db.select({ company: principal.companyId }).from(principal).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Person' })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: 'Person',
    createdAt: new Date(),
  })
  return principalId
}

describe.skipIf(!fixture.available)('company.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('creates, reads, updates, and deletes a company', async () => {
    const created = await createCompany({
      name: 'Acme Inc',
      domain: `acme-${suffix()}.com`,
      plan: 'Scale',
      mrrCents: 120000,
    })
    expect(created.name).toBe('Acme Inc')
    expect(created.plan).toBe('Scale')
    expect(created.mrrCents).toBe(120000)
    expect(created.customAttributes).toEqual({})

    const fetched = await getCompany(created.id as CompanyId)
    expect(fetched.id).toBe(created.id)

    const updated = await updateCompany(created.id as CompanyId, {
      plan: 'Enterprise',
      mrrCents: null,
    })
    expect(updated.plan).toBe('Enterprise')
    expect(updated.mrrCents).toBeNull()

    await deleteCompany(created.id as CompanyId)
    await expect(getCompany(created.id as CompanyId)).rejects.toMatchObject({
      code: 'COMPANY_NOT_FOUND',
    })
  })

  it('rejects a duplicate domain case-insensitively', async () => {
    const domain = `dup-${suffix()}.com`
    await createCompany({ name: 'First', domain })
    await expect(
      createCompany({ name: 'Second', domain: domain.toUpperCase() })
    ).rejects.toMatchObject({ code: 'COMPANY_DOMAIN_EXISTS' })
  })

  it('rejects a duplicate external id', async () => {
    const externalId = `crm-${suffix()}`
    await createCompany({ name: 'First', externalId })
    await expect(createCompany({ name: 'Second', externalId })).rejects.toMatchObject({
      code: 'COMPANY_EXTERNAL_ID_EXISTS',
    })
  })

  it('attaches, resolves, and detaches a person', async () => {
    const company = await createCompany({ name: 'Linked Co' })
    const principalId = await seedPrincipal()

    expect(await getForPrincipal(principalId)).toBeNull()

    await attachPrincipal(company.id as CompanyId, principalId)
    const resolved = await getForPrincipal(principalId)
    expect(resolved?.id).toBe(company.id)

    await detachPrincipal(principalId)
    expect(await getForPrincipal(principalId)).toBeNull()
  })

  it('counts members per company', async () => {
    const company = await createCompany({ name: `Counted ${suffix()}` })
    const p1 = await seedPrincipal()
    const p2 = await seedPrincipal()
    await attachPrincipal(company.id as CompanyId, p1)
    await attachPrincipal(company.id as CompanyId, p2)

    const list = await listCompanies()
    const row = list.find((c) => c.id === company.id)
    expect(row?.memberCount).toBe(2)
  })

  it('detaches people when the company is deleted (FK set null)', async () => {
    const company = await createCompany({ name: 'Doomed Co' })
    const principalId = await seedPrincipal()
    await attachPrincipal(company.id as CompanyId, principalId)

    await deleteCompany(company.id as CompanyId)

    const [row] = await testDb.select().from(principal).where(eq(principal.id, principalId))
    expect(row.companyId).toBeNull()
  })
})
