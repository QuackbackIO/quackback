import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

/**
 * 0283 turns Refreshed UI on for settings rows that still have no experiment
 * row. Existing rows keep their enabled value. The statement is read from
 * disk and pointed at scratch tables so a rewrite that flipped enabled on an
 * opted-out workspace fails here.
 */
const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../drizzle/0283_refined_visual_theme_default_on.sql'),
  'utf8'
)
const SCRATCH_SQL = MIGRATION_SQL.replace(/"settings"/g, '"_m0283_settings"')
  .replace(/"workspace_experiments"/g, '"_m0283_workspace_experiments"')
  .replace(/"kv_store"/g, '"_m0283_kv_store"')

const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
const dbAvailable = !!DB_URL
if (DB_URL) db = createDb(DB_URL, { max: 1 })

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

describe.skipIf(!dbAvailable)('migration 0283 refined visual theme default on', () => {
  it('enables missing rows and leaves existing enabled values alone', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`
          CREATE TABLE "_m0283_settings" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
          )
        `)
        await tx.execute(sql`
          CREATE TABLE "_m0283_workspace_experiments" (
            "settings_id" uuid NOT NULL,
            "experiment_id" text NOT NULL,
            "visible" boolean NOT NULL DEFAULT false,
            "enabled" boolean NOT NULL DEFAULT false,
            "created_at" timestamp with time zone NOT NULL DEFAULT now(),
            "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
            PRIMARY KEY ("settings_id", "experiment_id")
          )
        `)
        await tx.execute(sql`
          CREATE TABLE "_m0283_kv_store" (
            "workspace_key" text NOT NULL,
            "key" text NOT NULL,
            "value" jsonb NOT NULL,
            "expires_at" timestamp with time zone NOT NULL,
            PRIMARY KEY ("workspace_key", "key")
          )
        `)
        await tx.execute(sql`
          INSERT INTO "_m0283_kv_store" ("workspace_key", "key", "value", "expires_at")
          VALUES ('_', 'settings:workspace', '{"visualTheme":"legacy"}'::jsonb, now() + interval '1 hour')
        `)

        const inserted = await tx.execute<{ id: string }>(sql`
          INSERT INTO "_m0283_settings" (id) VALUES
            (gen_random_uuid()),
            (gen_random_uuid()),
            (gen_random_uuid()),
            (gen_random_uuid())
          RETURNING id
        `)
        const ids = (inserted as unknown as { id: string }[]).map((r) => r.id)
        const [missing, hiddenOn, alreadyOff, bothOn] = ids

        await tx.execute(sql`
          INSERT INTO "_m0283_workspace_experiments"
            ("settings_id", "experiment_id", "visible", "enabled")
          VALUES
            (${hiddenOn}::uuid, 'refined-visual-theme', false, true),
            (${alreadyOff}::uuid, 'refined-visual-theme', true, false),
            (${bothOn}::uuid, 'refined-visual-theme', true, true),
            (${hiddenOn}::uuid, 'other-experiment', false, false)
        `)

        await tx.execute(sql.raw(SCRATCH_SQL))

        const afterInsert = await tx.execute<{ n: string }>(sql`
          SELECT count(*)::text AS n FROM "_m0283_kv_store"
        `)
        expect(Number((afterInsert as unknown as { n: string }[])[0]?.n)).toBe(0)

        await tx.execute(sql`
          INSERT INTO "_m0283_kv_store" ("workspace_key", "key", "value", "expires_at")
          VALUES ('_', 'settings:workspace', '{"visualTheme":"legacy"}'::jsonb, now() + interval '1 hour')
        `)
        await tx.execute(sql.raw(SCRATCH_SQL))

        const afterReplay = await tx.execute<{ n: string }>(sql`
          SELECT count(*)::text AS n FROM "_m0283_kv_store"
        `)
        expect(Number((afterReplay as unknown as { n: string }[])[0]?.n)).toBe(1)

        const rows = await tx.execute<{
          settings_id: string
          experiment_id: string
          visible: boolean
          enabled: boolean
        }>(sql`
          SELECT settings_id, experiment_id, visible, enabled
          FROM "_m0283_workspace_experiments"
          ORDER BY experiment_id, settings_id
        `)
        const all = rows as unknown as {
          settings_id: string
          experiment_id: string
          visible: boolean
          enabled: boolean
        }[]

        const refined = all.filter((r) => r.experiment_id === 'refined-visual-theme')
        expect(refined).toHaveLength(4)

        const bySettings = new Map(refined.map((r) => [r.settings_id, r]))
        expect(bySettings.get(missing!)).toMatchObject({ visible: true, enabled: true })
        expect(bySettings.get(hiddenOn!)).toMatchObject({ visible: false, enabled: true })
        expect(bySettings.get(alreadyOff!)).toMatchObject({ visible: true, enabled: false })
        expect(bySettings.get(bothOn!)).toMatchObject({ visible: true, enabled: true })

        const other = all.find((r) => r.experiment_id === 'other-experiment')
        expect(other).toMatchObject({
          settings_id: hiddenOn,
          visible: false,
          enabled: false,
        })

        throw new Error('rollback')
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === 'rollback') return
        throw err
      })
  })
})
