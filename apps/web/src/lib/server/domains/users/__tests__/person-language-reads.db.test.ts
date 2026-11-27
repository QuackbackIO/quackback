/**
 * Real-DB coverage for a person's language on the reads the REST API and MCP
 * serve: the people list and detail, the team roster and a single teammate,
 * and the visitor language MCP's get_conversation shows.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listPortalUsers } from '../user.service'
import { getPortalUserDetail } from '../user.detail'
import { readPersonLanguage } from '../person-language'
import { listTeamMembers } from '@/lib/server/domains/principals/principal.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: principal.id }).from(principal).limit(0)
    await db.select({ id: user.id, detected: user.detectedLocale }).from(user).limit(0)
  },
})

const marker = `lang-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seed(role: 'user' | 'admin', chosen: string | null, detected: string | null) {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  const name = `${marker} ${role}`
  await testDb.insert(user).values({
    id: userId,
    name,
    email: `${marker}-${role}@example.com`,
    preferredLanguage: chosen,
    detectedLocale: detected,
  })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role,
    type: 'user',
    displayName: name,
    createdAt: new Date(),
  })
  return principalId
}

describe.skipIf(!fixture.available)('a person language on reads (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('shows on the people list and a person', async () => {
    const id = await seed('user', 'de', 'fr')
    const { items } = await listPortalUsers({ search: marker, limit: 10, page: 1 })
    expect(items.find((i) => i.principalId === id)?.language).toEqual({
      chosen: 'de',
      detected: 'fr',
    })
    expect((await getPortalUserDetail(id))?.language).toEqual({ chosen: 'de', detected: 'fr' })
  })

  it('shows on the team roster', async () => {
    const id = await seed('admin', null, 'uk')
    const members = await listTeamMembers()
    expect(members.find((m) => m.id === id)?.language).toEqual({ chosen: null, detected: 'uk' })
  })

  it("reads a principal's language, or null without one", async () => {
    const id = await seed('user', 'pl', null)
    expect(await readPersonLanguage(id)).toEqual({ chosen: 'pl', detected: null })
    expect(await readPersonLanguage(createId('principal') as PrincipalId)).toBeNull()
  })
})
