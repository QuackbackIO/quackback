import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type CompanyId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from './db-test-fixture'
import {
  companies,
  conversationAttributeDefinitions,
  conversations,
  principal,
  tickets,
  ticketStatuses,
  ticketConversations,
} from '@/lib/server/db'
import { attributeValueCounts } from '../domains/conversation-attributes/attribute-value-counts.service'
import { attributeValueBreakdown } from '../domains/conversation-attributes/attribute-reporting'
import {
  getActivityCounts,
  getCompanyWithMemberCount,
  listCompanies,
  listCompaniesPage,
  listMembers,
} from '../domains/companies/company.service'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('./db-test-fixture')).testDb,
}))

const fixture = await createDbTestFixture()
let companyId: CompanyId, owner: PrincipalId, customer: PrincipalId, ordinary: PrincipalId
let key: string
const from = new Date('2035-04-01T00:00:00Z')
const at = new Date('2035-04-01T12:00:00Z')
const to = new Date('2035-04-02T00:00:00Z')

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  expect(process.env.DATABASE_URL).toMatch(/\/quackback_test(?:\?|$)/)
  await fixture.begin()
  companyId = createId('company')
  owner = createId('principal')
  customer = createId('principal')
  ordinary = createId('principal')
  key = `acme_${createId('conversation_attribute')}`
  await testDb.insert(companies).values({ id: companyId, name: 'Acme', externalId: companyId })
  await testDb.insert(principal).values([
    { id: owner, type: 'user', role: 'admin', companyId, createdAt: at },
    { id: ordinary, type: 'user', role: 'user', companyId, createdAt: at },
  ])
  await testDb.insert(principal).values({
    id: customer,
    type: 'anonymous',
    role: 'user',
    testOwnerPrincipalId: owner,
    companyId,
    createdAt: at,
  })
  await testDb.insert(conversationAttributeDefinitions).values({
    key,
    label: 'Acme category',
    fieldType: 'select',
    options: [
      { id: 'real_option', label: 'Real' },
      { id: 'test_option', label: 'Test' },
    ],
  })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function seedConversations() {
  const testValue = { [key]: { v: 'test_option' } }
  return testDb
    .insert(conversations)
    .values([
      {
        visitorPrincipalId: ordinary,
        customAttributes: { [key]: { v: 'real_option' } },
        channel: 'messenger',
        createdAt: at,
      },
      { visitorPrincipalId: ordinary, customAttributes: {}, channel: 'messenger', createdAt: at },
      {
        visitorPrincipalId: customer,
        customAttributes: testValue,
        channel: 'messenger',
        createdAt: at,
      },
      { visitorPrincipalId: customer, customAttributes: {}, channel: 'messenger', createdAt: at },
      {
        visitorPrincipalId: owner,
        customAttributes: { ...testValue, test: true },
        channel: 'messenger',
        createdAt: at,
      },
      {
        visitorPrincipalId: ordinary,
        customAttributes: { ...testValue, test: 'true' },
        channel: 'messenger',
        createdAt: at,
      },
      {
        visitorPrincipalId: ordinary,
        customAttributes: { ...testValue, onboardingGenerated: true },
        channel: 'messenger',
        createdAt: at,
      },
    ])
    .returning({ id: conversations.id })
}

it('keeps test identities and protected markers out of attribute detection counts, including unset', async () => {
  const baseline = await attributeValueCounts({ key })
  const beforeUnset = baseline.find((row) => row.optionId === null)!.count
  await seedConversations()
  const counts = await attributeValueCounts({ key })
  expect(counts.find((row) => row.optionId === 'real_option')!.count).toBe(1)
  expect(counts.find((row) => row.optionId === 'test_option')!.count).toBe(0)
  expect(counts.find((row) => row.optionId === null)!.count).toBe(beforeUnset + 1)
})

it('keeps test identities and protected markers out of the date-window attribute breakdown', async () => {
  const baseline = await attributeValueBreakdown(key, from, to)
  await seedConversations()
  expect(await attributeValueBreakdown(key, from, to)).toEqual({
    values: [{ value: 'real_option', count: 1 }],
    unset: baseline.unset + 1,
  })
})

it('counts real company conversations and tickets while excluding test identities, markers and linked test threads', async () => {
  const rows = await seedConversations()
  const statusId = createId('ticket_status')
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'Acme open', slug: statusId })
  const [, , , paired] = await testDb
    .insert(tickets)
    .values([
      { title: 'Acme real request', statusId, requesterPrincipalId: ordinary, companyId },
      { title: 'Acme test customer', statusId, requesterPrincipalId: customer, companyId },
      {
        title: 'Acme test marker',
        statusId,
        requesterPrincipalId: ordinary,
        companyId,
        customAttributes: { test: true },
      },
      { title: 'Acme linked test', statusId, requesterPrincipalId: ordinary, companyId },
      {
        title: 'Acme removed request',
        statusId,
        requesterPrincipalId: ordinary,
        companyId,
        deletedAt: at,
      },
    ])
    .returning({ id: tickets.id })
  await testDb.insert(ticketConversations).values({
    ticketId: paired.id,
    conversationId: rows[4].id,
    ticketType: 'customer',
  })
  expect(await getActivityCounts(companyId)).toEqual({ conversations: 2, tickets: 1 })
})

it('keeps the test customer out of company directory counts and the company roster', async () => {
  expect((await getCompanyWithMemberCount(companyId)).memberCount).toBe(2)
  const listed = await listCompanies({ externalId: companyId })
  expect(listed.map((company) => ({ id: company.id, memberCount: company.memberCount }))).toEqual([
    { id: companyId, memberCount: 2 },
  ])
  const page = await listCompaniesPage({ externalId: companyId })
  expect(
    page.items.map((company) => ({ id: company.id, memberCount: company.memberCount }))
  ).toEqual([{ id: companyId, memberCount: 2 }])
  expect((await listMembers(companyId)).map((member) => member.principalId).sort()).toEqual(
    [owner, ordinary].sort()
  )
})
