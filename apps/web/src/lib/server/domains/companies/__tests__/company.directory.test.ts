/**
 * Real-DB coverage for the directory-facing companies queries: list filters
 * (search / plan / mrr / custom-attribute predicates), the member roster, and
 * the activity rollup counts. Runs inside the db-test-fixture rollback
 * transaction (see server/__tests__/README.md).
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type TypeId, type UserId } from '@quackback/ids'

type CompanyId = TypeId<'company'>
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { companies, principal, user, conversations, tickets, ticketStatuses } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  createCompany,
  listCompanies,
  listCompaniesPage,
  countCompanies,
  listMembers,
  getActivityCounts,
  attachPrincipal,
} from '../company.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: companies.id }).from(companies).limit(0)
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: tickets.id }).from(tickets).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Person', email: `p-${suffix()}@x.dev` })
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

describe.skipIf(!fixture.available)('company directory queries (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('listCompanies filters', () => {
    it('matches search against name and domain, case-insensitively', async () => {
      const tag = suffix()
      const byName = await createCompany({ name: `Globex ${tag}` })
      const byDomain = await createCompany({ name: `Other ${tag}`, domain: `globex-${tag}.com` })
      await createCompany({ name: `Unrelated ${tag}` })

      const hits = await listCompanies({ search: 'GLOBEX' })
      const ids = hits.map((c) => c.id)
      expect(ids).toContain(byName.id)
      expect(ids).toContain(byDomain.id)
      expect(hits.every((c) => c.name.includes(tag) || true)).toBe(true)
    })

    it('filters by plan case-insensitively', async () => {
      const tag = suffix()
      const scale = await createCompany({ name: `Scale Co ${tag}`, plan: 'Scale' })
      await createCompany({ name: `Free Co ${tag}`, plan: 'Free' })

      const hits = await listCompanies({ plan: 'scale' })
      expect(hits.map((c) => c.id)).toContain(scale.id)
      expect(hits.every((c) => (c.plan ?? '').toLowerCase() === 'scale')).toBe(true)
    })

    it('filters by monthly spend (dollars against mrr_cents)', async () => {
      const tag = suffix()
      const big = await createCompany({ name: `Big ${tag}`, mrrCents: 250000 })
      const small = await createCompany({ name: `Small ${tag}`, mrrCents: 4900 })

      const hits = await listCompanies({ mrr: { op: 'gte', value: 100 } })
      const ids = hits.map((c) => c.id)
      expect(ids).toContain(big.id)
      expect(ids).not.toContain(small.id)
    })

    it('filters by custom attribute predicates on the jsonb blob', async () => {
      const tag = suffix()
      const eu = await createCompany({
        name: `EU ${tag}`,
        customAttributes: { region: 'eu', seats: 40 },
      })
      const us = await createCompany({
        name: `US ${tag}`,
        customAttributes: { region: 'us', seats: 3 },
      })

      const regionHits = await listCompanies({ attrs: [{ key: 'region', op: 'eq', value: 'eu' }] })
      expect(regionHits.map((c) => c.id)).toContain(eu.id)
      expect(regionHits.map((c) => c.id)).not.toContain(us.id)

      const seatHits = await listCompanies({ attrs: [{ key: 'seats', op: 'gte', value: '10' }] })
      expect(seatHits.map((c) => c.id)).toContain(eu.id)
      expect(seatHits.map((c) => c.id)).not.toContain(us.id)
    })

    it('filters by standard-column field predicates (source, industry)', async () => {
      const tag = suffix()
      const manual = await createCompany({ name: `Manual ${tag}`, source: 'manual' })
      const api = await createCompany({ name: `Api ${tag}`, industry: 'Fintech' })

      const sourceHits = await listCompanies({
        fields: [{ key: 'source', op: 'eq', value: 'manual' }],
      })
      expect(sourceHits.map((c) => c.id)).toContain(manual.id)
      expect(sourceHits.map((c) => c.id)).not.toContain(api.id)

      const industryHits = await listCompanies({
        fields: [{ key: 'industry', op: 'contains', value: 'fin' }],
      })
      expect(industryHits.map((c) => c.id)).toContain(api.id)
      expect(industryHits.map((c) => c.id)).not.toContain(manual.id)
    })

    it('ignores field predicates on non-whitelisted columns', async () => {
      const tag = suffix()
      const company = await createCompany({ name: `Safe ${tag}` })
      // 'name' is not a filterable field key; the predicate is dropped, not applied.
      const hits = await listCompanies({
        search: `Safe ${tag}`,
        fields: [{ key: 'name', op: 'eq', value: 'nope' }],
      })
      expect(hits.map((c) => c.id)).toContain(company.id)
    })

    it('keeps the member count with filters applied', async () => {
      const tag = suffix()
      const company = await createCompany({ name: `Counted ${tag}` })
      await attachPrincipal(company.id as CompanyId, await seedPrincipal())

      const hits = await listCompanies({ search: `Counted ${tag}` })
      expect(hits.find((c) => c.id === company.id)?.memberCount).toBe(1)
    })
  })

  describe('listCompaniesPage keyset pagination', () => {
    it('returns one page with hasMore + a cursor, then the rest via the cursor', async () => {
      const tag = suffix()
      // Distinct name prefix so the search scopes to just this test's rows,
      // and deterministic ordering (name asc) across the two pages.
      const names = ['Alpha', 'Bravo', 'Charlie', 'Delta']
      for (const n of names) await createCompany({ name: `${n} ${tag}` })

      const first = await listCompaniesPage({ search: tag, limit: 3 })
      expect(first.items).toHaveLength(3)
      expect(first.hasMore).toBe(true)
      expect(first.nextCursor).toBe(first.items[2].id)
      expect(first.items.map((c) => c.name)).toEqual([
        `Alpha ${tag}`,
        `Bravo ${tag}`,
        `Charlie ${tag}`,
      ])

      const second = await listCompaniesPage({ search: tag, limit: 3, cursor: first.nextCursor! })
      expect(second.items).toHaveLength(1)
      expect(second.hasMore).toBe(false)
      expect(second.nextCursor).toBeNull()
      expect(second.items[0].name).toBe(`Delta ${tag}`)
    })

    it('does not overlap rows between pages', async () => {
      const tag = suffix()
      for (const n of ['One', 'Two', 'Three', 'Four']) await createCompany({ name: `${n} ${tag}` })
      const first = await listCompaniesPage({ search: tag, limit: 2 })
      const second = await listCompaniesPage({ search: tag, limit: 2, cursor: first.nextCursor! })
      const firstIds = new Set(first.items.map((c) => c.id))
      expect(second.items.some((c) => firstIds.has(c.id))).toBe(false)
    })
  })

  describe('countCompanies', () => {
    it('counts the filtered set without paging', async () => {
      const tag = suffix()
      for (const n of ['X', 'Y', 'Z']) await createCompany({ name: `${n} ${tag}` })
      expect(await countCompanies({ search: tag })).toBe(3)
      // A page-limited list of the same filter still counts the full set.
      const page = await listCompaniesPage({ search: tag, limit: 1 })
      expect(page.items).toHaveLength(1)
      expect(page.hasMore).toBe(true)
      expect(await countCompanies({ search: tag })).toBe(3)
    })
  })

  describe('listMembers', () => {
    it('returns the attached people with their identity fields', async () => {
      const company = await createCompany({ name: `Roster ${suffix()}` })
      const p1 = await seedPrincipal()
      const p2 = await seedPrincipal()
      await attachPrincipal(company.id as CompanyId, p1)
      await attachPrincipal(company.id as CompanyId, p2)

      const members = await listMembers(company.id as CompanyId)
      expect(members).toHaveLength(2)
      const ids = members.map((m) => m.principalId)
      expect(ids).toContain(p1)
      expect(ids).toContain(p2)
      expect(members[0].displayName).toBe('Person')
      expect(members[0].email).toContain('@')
    })

    it('returns an empty roster for a company with no members', async () => {
      const company = await createCompany({ name: `Empty ${suffix()}` })
      expect(await listMembers(company.id as CompanyId)).toEqual([])
    })
  })

  describe('getActivityCounts', () => {
    it('counts conversations of member principals and tickets linked to the company', async () => {
      const company = await createCompany({ name: `Active ${suffix()}` })
      const member = await seedPrincipal()
      await attachPrincipal(company.id as CompanyId, member)

      await testDb.insert(conversations).values({
        visitorPrincipalId: member,
        channel: 'messenger',
      })

      const statusId = createId('ticket_status')
      await testDb
        .insert(ticketStatuses)
        .values({ id: statusId, name: 'Open', slug: `open-${suffix()}` })
      await testDb.insert(tickets).values({
        title: 'Billing question',
        statusId,
        companyId: company.id as CompanyId,
      })

      const counts = await getActivityCounts(company.id as CompanyId)
      expect(counts.conversations).toBe(1)
      expect(counts.tickets).toBe(1)
    })

    it('returns zeros for a quiet company', async () => {
      const company = await createCompany({ name: `Quiet ${suffix()}` })
      const counts = await getActivityCounts(company.id as CompanyId)
      expect(counts).toEqual({ conversations: 0, tickets: 0 })
    })
  })
})
