/**
 * Real-DB coverage for the user-tags service and the People-list tag filter.
 *
 * The filter is a subquery over user_tag_assignments inside listPortalUsers,
 * and get-or-create rides the unique-name race path — both need Postgres.
 * Runs inside the db-test-fixture rollback transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId, type UserTagId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user, userTags, userTagAssignments } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  listUserTags,
  listTagsForPrincipal,
  getOrCreateUserTag,
  assignUserTag,
  removeUserTag,
} from '../user-tags.service'
import { listPortalUsers } from '../user.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: userTags.id }).from(userTags).limit(0)
    await db
      .select({ principalId: userTagAssignments.principalId })
      .from(userTagAssignments)
      .limit(0)
  },
})

const runSuffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedUser(name: string): Promise<{ userId: UserId; principalId: PrincipalId }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({
    id: userId,
    name,
    email: `${runSuffix()}@example.com`,
    emailVerified: false,
  })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: name,
    createdAt: new Date(),
  })
  return { userId, principalId }
}

describe.skipIf(!fixture.available)('user tags', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('get-or-create mints a tag once and reuses it case-insensitively', async () => {
    const name = `vip-${runSuffix()}`
    const first = await getOrCreateUserTag(name)
    const second = await getOrCreateUserTag(name.toUpperCase())

    expect(second.id).toBe(first.id)
    const all = await listUserTags()
    expect(all.filter((t) => t.name.toLowerCase() === name.toLowerCase())).toHaveLength(1)
  })

  it('assign is idempotent and remove detaches', async () => {
    const person = await seedUser('Tag Target')
    const tag = await getOrCreateUserTag(`beta-${runSuffix()}`)

    await assignUserTag(person.principalId, tag.id)
    await assignUserTag(person.principalId, tag.id)

    let tags = await listTagsForPrincipal(person.principalId)
    expect(tags.map((t) => t.id)).toEqual([tag.id])

    await removeUserTag(person.principalId, tag.id)
    tags = await listTagsForPrincipal(person.principalId)
    expect(tags).toHaveLength(0)
  })

  it('filters the People list by tag, returning only tagged users', async () => {
    const tagged = await seedUser('Tagged Person')
    const untagged = await seedUser('Untagged Person')
    const tag = await getOrCreateUserTag(`filter-${runSuffix()}`)
    await assignUserTag(tagged.principalId, tag.id)

    const result = await listPortalUsers({ tagIds: [tag.id], limit: 100 })
    const ids = result.items.map((i) => i.principalId)

    expect(ids).toContain(tagged.principalId)
    expect(ids).not.toContain(untagged.principalId)
  })

  it('OR logic: a user with ANY selected tag matches', async () => {
    const person = await seedUser('Either Tag')
    const tagA = await getOrCreateUserTag(`or-a-${runSuffix()}`)
    const tagB = await getOrCreateUserTag(`or-b-${runSuffix()}`)
    await assignUserTag(person.principalId, tagB.id)

    const result = await listPortalUsers({ tagIds: [tagA.id, tagB.id], limit: 100 })
    expect(result.items.map((i) => i.principalId)).toContain(person.principalId)
  })

  it('an unknown tag id filters everything out', async () => {
    await seedUser('Nobody Matches')
    const ghost = createId('user_tag') as UserTagId

    const result = await listPortalUsers({ tagIds: [ghost], limit: 100 })
    expect(result.items).toHaveLength(0)
  })
})
