import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

// 0084 collapses the three workspace anon toggles into a single `allowAnonymous`
// master switch, and bumps per-board anonymous tiers where the old workspace
// flag was off — so defaulting allowAnonymous=true does not re-open anonymous
// interaction on boards the admin had locked down.
//
// This is a one-time data migration, so we keep a SINGLE regression pin rather
// than an exhaustive per-branch suite: the fail-open the access-matrix audit
// found. The original SQL gated both passes on `portal_config IS NOT NULL`, so a
// tenant whose single settings row had a NULL/empty portal_config (config-file
// installs, half-onboarded rows, the dev/test seed) got neither the per-board
// tier bump nor an allowAnonymous write — and the runtime then resolved
// allowAnonymous to its fail-open default, silently re-opening anonymous
// comment/submit on upgrade. This pins the NULL edge fail-closed.

const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../drizzle/0084_workspace_allow_anonymous_master.sql'),
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

const ACCESS_ANON = {
  view: 'anonymous',
  vote: 'anonymous',
  comment: 'anonymous',
  submit: 'anonymous',
  segments: { view: [], vote: [], comment: [], submit: [] },
  moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
}

describe.skipIf(!dbAvailable)('migration 0084 backfill', () => {
  it('fails closed when portal_config is NULL: bumps anon comment/submit and writes allowAnonymous (P1 regression pin)', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        // Deterministic setup: a single settings row with a NULL portal_config
        // (the edge the original SQL skipped). Nothing FK-references settings,
        // so resetting it is safe; the whole tx rolls back afterwards.
        await tx.execute(sql`DELETE FROM "settings"`)
        await tx.execute(sql`
          INSERT INTO "settings" (id, name, slug, created_at, portal_config)
          VALUES (gen_random_uuid(), 'M0084', 'm0084-test', now(), NULL)
        `)
        // boards.id is a uuid column with no DB-level default (the TypeID
        // default is applied at the app layer), so let Postgres mint one.
        const inserted = await tx.execute<{ id: string }>(sql`
          INSERT INTO "boards" (id, slug, name, access)
          VALUES (gen_random_uuid(), 'm0084-board', 'M0084 Board', ${JSON.stringify(
            ACCESS_ANON
          )}::jsonb)
          RETURNING id
        `)
        const boardId = (inserted as unknown as { id: string }[])[0].id

        for (const stmt of MIGRATION_SQL) {
          await tx.execute(sql.raw(stmt))
        }

        // postgres-js returns rows directly as an array and parses jsonb.
        const boardRows = await tx.execute<{ access: typeof ACCESS_ANON }>(sql`
          SELECT access FROM "boards" WHERE id = ${boardId}
        `)
        const access = (boardRows as unknown as { access: typeof ACCESS_ANON }[])[0].access
        expect(access.view).toBe('anonymous') // view has no workspace ceiling
        expect(access.comment).toBe('authenticated') // anonymousCommenting default false -> bumped
        expect(access.submit).toBe('authenticated') // anonymousPosting default false -> bumped
        expect(access.vote).toBe('anonymous') // anonymousVoting default true -> not bumped

        const settingsRows = await tx.execute<{ features: Record<string, unknown> | null }>(sql`
          SELECT (portal_config::jsonb)->'features' AS features FROM "settings" LIMIT 1
        `)
        const features = (
          settingsRows as unknown as { features: Record<string, unknown> | null }[]
        )[0].features
        expect(features?.allowAnonymous).toBe(true) // master flag materialized, not left to runtime default

        throw new Error('__ROLLBACK__') // abort the tx so dev/test data is untouched
      })
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== '__ROLLBACK__') throw e
      })
  })
})
