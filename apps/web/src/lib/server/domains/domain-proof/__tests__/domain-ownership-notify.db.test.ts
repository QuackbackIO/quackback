/**
 * Who is told when a domain added by name loses its ownership record, and
 * what they are told, against a real database rolled back after each test.
 * Emails are recorded rather than sent.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  eq,
  inAppNotifications,
  inArray,
  permissions,
  principal,
  principalRoleAssignments,
  rolePermissions,
  roles,
  user,
} from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const sent = vi.hoisted(() => ({ emails: [] as Record<string, unknown>[], fail: false }))
vi.mock('@quackback/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email')>()),
  isEmailConfigured: () => true,
  sendDomainAttentionEmail: async (params: Record<string, unknown>) => {
    if (sent.fail) throw new Error('provider down')
    sent.emails.push(params)
    return { sent: true }
  },
}))

const resolved = vi.hoisted(() => ({ single: 0 }))
vi.mock('@/lib/server/policy/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/policy/permissions')>()
  return {
    ...actual,
    permissionsForPrincipal: (...args: Parameters<typeof actual.permissionsForPrincipal>) => {
      resolved.single += 1
      return actual.permissionsForPrincipal(...args)
    },
  }
})

import {
  notifyDomainOwnershipLapsed,
  notifyDomainOwnershipMissing,
} from '../domain-ownership-notify'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: inAppNotifications.id }).from(inAppNotifications).limit(0)
  },
})

const domain = { name: 'acme.com', ownershipToken: 'abc123' }

async function seedPerson(
  role: 'admin' | 'member' | 'user',
  granted?: PermissionKey[]
): Promise<PrincipalId> {
  const userId = createId('user')
  const principalId = createId('principal')
  await testDb.insert(user).values({ id: userId, name: 'Acme', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  if (granted) {
    // A role assigned across the workspace, which replaces the legacy role's bundle.
    const roleId = createId('role')
    await testDb.insert(roles).values({ id: roleId, key: `test-${roleId}`, name: 'Acme role' })
    await testDb.insert(principalRoleAssignments).values({ principalId, roleId })
    for (const key of granted) {
      await testDb.insert(permissions).values({ key, category: 'settings' }).onConflictDoNothing()
      const [row] = await testDb.select().from(permissions).where(eq(permissions.key, key))
      await testDb.insert(rolePermissions).values({ roleId, permissionId: row.id })
    }
  }
  return principalId
}

async function bellsFor(people: PrincipalId[]) {
  return testDb
    .select()
    .from(inAppNotifications)
    .where(
      and(
        inArray(inAppNotifications.principalId, people),
        eq(inAppNotifications.type, 'domain_needs_attention')
      )
    )
}

describe.skipIf(!fixture.available)('domain ownership notices (real DB, rolled back)', () => {
  beforeEach(async () => {
    sent.emails.length = 0
    sent.fail = false
    await fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('warns whoever may manage domains, with the record and the date', async () => {
    const admin = await seedPerson('admin')
    const member = await seedPerson('member')

    expect(
      await notifyDomainOwnershipMissing(domain, new Date('2026-11-08T06:00:00Z'), { ring: true })
    ).toBe(true)

    const bells = await bellsFor([admin, member])
    expect(bells.map((b) => [b.principalId, b.title, b.body])).toEqual([
      [
        admin,
        'acme.com needs attention',
        'The ownership record (TXT _quackback.acme.com) is missing. Add it back by November 8, 2026 to keep acme.com verified.',
      ],
    ])
    expect(sent.emails).toHaveLength(1)
    expect(sent.emails[0]).toMatchObject({
      domain: 'acme.com',
      record: { name: '_quackback.acme.com', value: 'quackback-domain-verification=abc123' },
      deadline: 'November 8, 2026',
    })
  })

  it('says the warning was not delivered when every email failed, so it is tried again', async () => {
    await seedPerson('admin')
    sent.fail = true
    expect(
      await notifyDomainOwnershipMissing(domain, new Date('2026-11-08T06:00:00Z'), { ring: true })
    ).toBe(false)
  })

  it('only emails when the bell already rang for this warning', async () => {
    const admin = await seedPerson('admin')

    expect(
      await notifyDomainOwnershipMissing(domain, new Date('2026-11-08T06:00:00Z'), { ring: false })
    ).toBe(true)

    expect(await bellsFor([admin])).toEqual([])
    expect(sent.emails).toHaveLength(1)
  })

  it('tells a teammate whose role grants managing settings, and not an admin whose role does not', async () => {
    const granted = await seedPerson('member', [PERMISSIONS.SETTINGS_MANAGE])
    const withheld = await seedPerson('admin', [PERMISSIONS.CONVERSATION_VIEW])
    const legacy = await seedPerson('admin')
    resolved.single = 0

    await notifyDomainOwnershipLapsed(domain, [])

    const bells = await bellsFor([granted, withheld, legacy])
    expect(bells.map((b) => b.principalId).sort()).toEqual([granted, legacy].sort())
    // Resolved together, not one teammate at a time.
    expect(resolved.single).toBe(0)
  })

  it('names the sign-in domains that stopped with it', async () => {
    const admin = await seedPerson('admin')

    await notifyDomainOwnershipLapsed(domain, ['acme.com', 'eu.acme.com'])

    const bells = await bellsFor([admin])
    expect(bells.map((b) => [b.title, b.body])).toEqual([
      [
        'acme.com is no longer verified',
        'The ownership record (TXT _quackback.acme.com) is still missing. Sign-in is no longer verified for acme.com, eu.acme.com.',
      ],
    ])
    expect(sent.emails[0]).toMatchObject({ signInDomains: ['acme.com', 'eu.acme.com'] })
  })
})
