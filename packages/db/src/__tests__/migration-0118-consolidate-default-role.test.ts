import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

// 0118 collapses the duplicate SSO default-role controls. Single regression pin:
// a mapping-on row whose live default lived in attribute_mapping.defaultRole must
// have that value promoted to auto_provision_role (which was unreachable while
// mapping was on), and the nested key stripped — so behavior is preserved when the
// code stops reading defaultRole.
const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../drizzle/0118_identity_provider_consolidate_default_role.sql'),
  'utf8'
)
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter(Boolean)

const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
const dbAvailable = !!DB_URL
if (DB_URL) db = createDb(DB_URL, { max: 1 })

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

describe.skipIf(!dbAvailable)('migration 0118 consolidate default role', () => {
  it('promotes attribute_mapping.defaultRole into auto_provision_role and strips the key (regression pin)', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        const mapping = {
          claimPath: 'groups',
          rules: [{ whenContains: 'admins', role: 'admin' }],
          defaultRole: 'admin',
          syncOnEverySignIn: true,
        }
        const inserted = await tx.execute<{ id: string }>(sql`
          INSERT INTO "identity_provider"
            (id, registration_id, label, client_id, enabled, auto_create_users,
             auto_provision_role, attribute_mapping, show_button)
          VALUES
            (gen_random_uuid(), 'oidc_m0118', 'M0118', 'cid', true, true,
             NULL, ${JSON.stringify(mapping)}::jsonb, false)
          RETURNING id
        `)
        const id = (inserted as unknown as { id: string }[])[0].id

        for (const stmt of MIGRATION_SQL) {
          await tx.execute(sql.raw(stmt))
        }

        const rows = await tx.execute<{
          auto_provision_role: string
          attribute_mapping: Record<string, unknown>
        }>(sql`
          SELECT auto_provision_role, attribute_mapping
          FROM "identity_provider" WHERE id = ${id}
        `)
        const row = (
          rows as unknown as {
            auto_provision_role: string
            attribute_mapping: Record<string, unknown>
          }[]
        )[0]
        expect(row.auto_provision_role).toBe('admin') // promoted from the nested default
        expect(row.attribute_mapping.defaultRole).toBeUndefined() // key stripped
        expect(Array.isArray(row.attribute_mapping.rules)).toBe(true) // rules preserved
        expect(row.attribute_mapping.syncOnEverySignIn).toBe(true) // other keys preserved

        throw new Error('__ROLLBACK__') // abort the tx so dev/test data is untouched
      })
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== '__ROLLBACK__') throw e
      })
  })
})
