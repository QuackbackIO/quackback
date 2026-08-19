import { describe, it, expect, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { generateId, type PrincipalId } from '@quackback/ids'
import { createDb, type Database } from '../client'
import { principal } from '../schema/auth'
import { roles, principalRoleAssignments } from '../schema/rbac'
import { seedSystemData } from '../seed-system'
import { SYSTEM_ROLES } from '../rbac-catalogue'

// Backfill pin (the migration-0118 txn + __ROLLBACK__ pattern): synthetic
// principals across the role/type matrix get the non-regressing assignment, and
// a second seed run adds no duplicates. Skips without Postgres (CI). Requires the
// 0126 tables (run `bun run db:migrate` against quackback_test first).
const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
if (DB_URL) db = createDb(DB_URL, { max: 1 })

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
const ROLLBACK = '__ROLLBACK__'

describe.skipIf(!DB_URL)('0126 backfill principal.role -> assignment', () => {
  it('maps admin->Owner, member->Manager, user->none (service principals too) and is idempotent', async () => {
    if (!db) return
    const ids = {
      admin: generateId('principal'),
      member: generateId('principal'),
      user: generateId('principal'),
      svcAdmin: generateId('principal'),
      svcMember: generateId('principal'),
    }
    await db
      .transaction(async (tx) => {
        await tx.insert(principal).values([
          { id: ids.admin, userId: null, role: 'admin', type: 'user', createdAt: new Date() },
          { id: ids.member, userId: null, role: 'member', type: 'user', createdAt: new Date() },
          { id: ids.user, userId: null, role: 'user', type: 'user', createdAt: new Date() },
          { id: ids.svcAdmin, userId: null, role: 'admin', type: 'service', createdAt: new Date() },
          {
            id: ids.svcMember,
            userId: null,
            role: 'member',
            type: 'service',
            createdAt: new Date(),
          },
        ])

        await seedSystemData(tx)

        const assigned = await rolesByPrincipal(tx, Object.values(ids))
        expect(assigned.get(ids.admin)).toBe(SYSTEM_ROLES.OWNER)
        expect(assigned.get(ids.member)).toBe(SYSTEM_ROLES.MANAGER)
        expect(assigned.has(ids.user)).toBe(false)
        expect(assigned.get(ids.svcAdmin)).toBe(SYSTEM_ROLES.OWNER)
        expect(assigned.get(ids.svcMember)).toBe(SYSTEM_ROLES.MANAGER)

        // Idempotent: a second run adds no duplicate assignments.
        const before = await countAssignments(tx, Object.values(ids))
        expect(before).toBe(4) // admin, member, svcAdmin, svcMember (user gets none)
        await seedSystemData(tx)
        const after = await countAssignments(tx, Object.values(ids))
        expect(after).toBe(before)

        throw new Error(ROLLBACK)
      })
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== ROLLBACK) throw e
      })
  })
})

async function rolesByPrincipal(tx: Tx, principalIds: PrincipalId[]): Promise<Map<string, string>> {
  const rows = await tx
    .select({ principalId: principalRoleAssignments.principalId, roleKey: roles.key })
    .from(principalRoleAssignments)
    .innerJoin(roles, eq(roles.id, principalRoleAssignments.roleId))
    .where(inArray(principalRoleAssignments.principalId, principalIds))
  const m = new Map<string, string>()
  for (const r of rows) m.set(r.principalId, r.roleKey)
  return m
}

async function countAssignments(tx: Tx, principalIds: PrincipalId[]): Promise<number> {
  const rows = await tx
    .select({ id: principalRoleAssignments.id })
    .from(principalRoleAssignments)
    .where(inArray(principalRoleAssignments.principalId, principalIds))
  return rows.length
}
