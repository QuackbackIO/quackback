/**
 * Accounts on a provider matched to teammates, against a real database: one
 * teammate per account and one account per teammate, only teammates can be
 * matched, a lookup goes by the immutable id first and refreshes a renamed
 * login, and falls back to the login only when a delivery names no id.
 */
import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest'
import { createId, type IntegrationUserMappingId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
import { integrations, integrationUserMappings, principal, user, eq } from '@/lib/server/db'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/shared/errors'
import {
  deleteUserMapping,
  externalUserForPrincipal,
  listUserMappings,
  principalForExternalUser,
  upsertUserMapping,
} from '../user-mappings'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: integrationUserMappings.id }).from(integrationUserMappings).limit(0)
  },
})

describe.skipIf(!fixture.available)('integration user mappings', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  async function person(name: string, role: 'admin' | 'member' | 'user', type = 'user') {
    const [row] = await testDb
      .insert(user)
      .values({ name, email: `${name.toLowerCase()}-${createId('user')}@example.test` })
      .returning()
    const [p] = await testDb
      .insert(principal)
      .values({ userId: row.id, type, role, displayName: name, createdAt: new Date() })
      .returning()
    return p.id as PrincipalId
  }

  async function seed() {
    const [integration] = await testDb
      .insert(integrations)
      .values({ integrationType: 'github', status: 'active', config: {} })
      .returning()
    return { integrationId: integration.id, jane: await person('Jane', 'member') }
  }

  it('matches an account, moves it to another teammate and lists it with the name', async () => {
    const { integrationId, jane } = await seed()
    const ravi = await person('Ravi', 'admin')
    const first = await upsertUserMapping({
      integrationId,
      externalUserId: '42',
      externalLogin: 'jane-gh',
      externalDisplayName: 'Jane D.',
      principalId: jane,
      createdByPrincipalId: ravi,
    })
    expect(first.previous).toBeNull()
    const moved = await upsertUserMapping({
      integrationId,
      externalUserId: '42',
      externalLogin: 'jane-gh',
      principalId: ravi,
    })
    expect(moved.previous).toMatchObject({ principalId: jane })
    expect(moved.mapping).toMatchObject({ id: first.mapping.id, principalId: ravi })
    expect(await listUserMappings(integrationId)).toEqual([
      expect.objectContaining({ externalUserId: '42', principalId: ravi, teammateName: 'Ravi' }),
    ])
  })

  it('refuses a teammate already matched to another account', async () => {
    const { integrationId, jane } = await seed()
    await upsertUserMapping({
      integrationId,
      externalUserId: '1',
      externalLogin: 'a',
      principalId: jane,
    })
    await expect(
      upsertUserMapping({
        integrationId,
        externalUserId: '2',
        externalLogin: 'b',
        principalId: jane,
      })
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('only matches teammates, on a connection that exists', async () => {
    const { integrationId } = await seed()
    const customer = await person('Cust', 'user')
    const service = await person('Bot', 'member', 'service')
    for (const principalId of [customer, service, createId('principal') as PrincipalId])
      await expect(
        upsertUserMapping({ integrationId, externalUserId: '9', externalLogin: 'x', principalId })
      ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      upsertUserMapping({
        integrationId: createId('integration'),
        externalUserId: '9',
        externalLogin: 'x',
        principalId: await person('Lee', 'member'),
      })
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(await testDb.select().from(integrationUserMappings)).toEqual([])
  })

  it('finds a teammate by id first and follows a renamed login', async () => {
    const { integrationId, jane } = await seed()
    await upsertUserMapping({
      integrationId,
      externalUserId: '42',
      externalLogin: 'jane-old',
      principalId: jane,
    })
    expect(
      await principalForExternalUser(integrationId, { externalUserId: '42', login: 'jane-new' })
    ).toBe(jane)
    const [row] = await testDb.select().from(integrationUserMappings)
    expect(row.externalLogin).toBe('jane-new')
    // The old login now belongs to another account: an id that matches nothing is nobody.
    expect(
      await principalForExternalUser(integrationId, { externalUserId: '77', login: 'jane-new' })
    ).toBeNull()
    // Without an id, the login matches in any case.
    expect(await principalForExternalUser(integrationId, { login: 'JANE-NEW' })).toBe(jane)
    expect(await principalForExternalUser(integrationId, {})).toBeNull()
  })

  it('names the account a teammate is matched to, per connection', async () => {
    const { integrationId, jane } = await seed()
    const [other] = await testDb
      .insert(integrations)
      .values({ integrationType: 'gitlab', status: 'active', config: {} })
      .returning()
    await upsertUserMapping({
      integrationId,
      externalUserId: '42',
      externalLogin: 'jg',
      principalId: jane,
    })
    expect(await externalUserForPrincipal(integrationId, jane)).toEqual({
      externalUserId: '42',
      externalLogin: 'jg',
    })
    expect(await externalUserForPrincipal(other.id, jane)).toBeNull()
    expect(await principalForExternalUser(other.id, { externalUserId: '42' })).toBeNull()
  })

  it('removes a mapping only through its own connection', async () => {
    const { integrationId, jane } = await seed()
    const [other] = await testDb
      .insert(integrations)
      .values({ integrationType: 'gitlab', status: 'active', config: {} })
      .returning()
    const { mapping } = await upsertUserMapping({
      integrationId,
      externalUserId: '42',
      externalLogin: 'jg',
      principalId: jane,
    })
    await expect(deleteUserMapping(other.id, mapping.id)).rejects.toBeInstanceOf(NotFoundError)
    expect(await deleteUserMapping(integrationId, mapping.id)).toMatchObject({ id: mapping.id })
    await expect(
      deleteUserMapping(integrationId, mapping.id as IntegrationUserMappingId)
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(
      await testDb
        .select()
        .from(integrationUserMappings)
        .where(eq(integrationUserMappings.integrationId, integrationId))
    ).toEqual([])
  })
})
