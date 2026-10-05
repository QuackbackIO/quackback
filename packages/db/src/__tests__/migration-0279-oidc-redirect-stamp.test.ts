import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

/**
 * 0279 records every OIDC identity provider that exists on the first apply
 * over a pre-1.7 schema as `legacy` in settings.auth_config, so sign-in keeps
 * sending the redirect URI its IdP has registered. The stamp statements are
 * read from disk and pointed at scratch tables, including the guard table, so
 * both "upgrading from 1.6" and "already on 1.7" can be staged.
 */
const STAMP_SQL = readFileSync(join(__dirname, '../../drizzle/0279_better_auth_17.sql'), 'utf8')
  .split('--> statement-breakpoint')
  .filter((stmt) => stmt.includes('_m0279_auth_config'))
  .join('\n')
  .replace(/"settings"/g, '"_m0279_settings"')
  .replace(/"identity_provider"/g, '"_m0279_identity_provider"')
  .replace(/'oauth_client_resource'/g, "'_m0279_oauth_client_resource'")

const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
const dbAvailable = !!DB_URL
if (DB_URL) db = createDb(DB_URL, { max: 1 })

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

async function inRollback(fn: (tx: Tx) => Promise<void>) {
  await db!
    .transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TABLE "_m0279_settings" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "auth_config" text)
      `)
      await tx.execute(sql`
        CREATE TABLE "_m0279_identity_provider" ("registration_id" text NOT NULL)
      `)
      await fn(tx)
      throw new Error('rollback')
    })
    .catch((err: unknown) => {
      if (err instanceof Error && err.message === 'rollback') return
      throw err
    })
}

async function authConfigs(tx: Tx): Promise<Array<string | null>> {
  const rows = (await tx.execute(
    sql`SELECT auth_config FROM "_m0279_settings" ORDER BY auth_config NULLS FIRST`
  )) as unknown as Array<{ auth_config: string | null }>
  return rows.map((r) => r.auth_config)
}

describe.skipIf(!dbAvailable)('migration 0279 OIDC redirect stamp', () => {
  it('stamps providers legacy on a pre-1.7 schema and nothing once 1.7 is applied', async () => {
    expect(STAMP_SQL).toContain('oidcRedirectStyles')
    await inRollback(async (tx) => {
      await tx.execute(sql`
        INSERT INTO "_m0279_settings" (auth_config) VALUES
          ('{"oauth":{"password":false},"openSignup":false,"oidcRedirectStyles":{"sso":"current"}}')
      `)
      await tx.execute(sql`
        INSERT INTO "_m0279_identity_provider" (registration_id) VALUES ('sso'), ('custom-oidc')
      `)

      // Upgrading from 1.6: the guard table does not exist yet.
      await tx.execute(sql.raw(STAMP_SQL))
      await tx.execute(sql.raw(STAMP_SQL))
      const [stamped] = await authConfigs(tx)
      expect(JSON.parse(stamped!)).toEqual({
        oauth: { password: false },
        openSignup: false,
        // An existing entry wins; the other provider is stamped legacy.
        oidcRedirectStyles: { sso: 'current', 'custom-oidc': 'legacy' },
      })

      // Already on 1.7 (or a replay after this file ran): a provider created
      // since stays unrecorded, which reads as current.
      await tx.execute(sql`CREATE TABLE "_m0279_oauth_client_resource" ("id" text)`)
      await tx.execute(sql`INSERT INTO "_m0279_identity_provider" VALUES ('oidc_new')`)
      await tx.execute(sql.raw(STAMP_SQL))
      expect(await authConfigs(tx)).toEqual([stamped])
    })
  })

  it('handles a null or invalid auth_config and no providers', async () => {
    await inRollback(async (tx) => {
      await tx.execute(sql`
        INSERT INTO "_m0279_settings" (auth_config) VALUES ('not json')
      `)
      // No providers: a no-op.
      await tx.execute(sql.raw(STAMP_SQL))
      expect(await authConfigs(tx)).toEqual(['not json'])

      await tx.execute(sql`INSERT INTO "_m0279_identity_provider" VALUES ('sso')`)
      await tx.execute(sql`INSERT INTO "_m0279_settings" (auth_config) VALUES (NULL)`)
      await tx.execute(sql.raw(STAMP_SQL))
      // Invalid JSON is left alone rather than overwritten; null gains the stamp.
      const [invalid, fromNull] = await authConfigs(tx)
      expect(invalid).toBe('not json')
      expect(JSON.parse(fromNull!)).toEqual({ oidcRedirectStyles: { sso: 'legacy' } })
    })
  })
})
