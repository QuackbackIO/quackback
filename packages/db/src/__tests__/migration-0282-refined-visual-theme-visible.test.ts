import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

/**
 * 0282 makes Labs "Refreshed UI" visible on every settings row. Enabled is
 * left alone: a missing row starts off, and a workspace that already opted
 * in stays on. The statement is read from disk and pointed at scratch
 * tables so a rewrite that flipped enabled or skipped an existing hide
 * fails here.
 */
const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../drizzle/0282_refined_visual_theme_visible.sql'),
  'utf8'
)
const SCRATCH_SQL = MIGRATION_SQL.replace(/"settings"/g, '"_m0282_settings"').replace(
  /"workspace_experiments"/g,
  '"_m0282_workspace_experiments"'
)

const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
const dbAvailable = !!DB_URL
if (DB_URL) db = createDb(DB_URL, { max: 1 })

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

describe.skipIf(!dbAvailable)('migration 0282 refined visual theme visible', () => {
  it('makes refined-visual-theme visible without changing enabled', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`
          CREATE TABLE "_m0282_settings" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
          )
        `)
        await tx.execute(sql`
          CREATE TABLE "_m0282_workspace_experiments" (
            "settings_id" uuid NOT NULL,
            "experiment_id" text NOT NULL,
            "visible" boolean NOT NULL DEFAULT false,
            "enabled" boolean NOT NULL DEFAULT false,
            "created_at" timestamp with time zone NOT NULL DEFAULT now(),
            "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
            PRIMARY KEY ("settings_id", "experiment_id")
          )
        `)

        const inserted = await tx.execute<{ id: string }>(sql`
          INSERT INTO "_m0282_settings" (id) VALUES
            (gen_random_uuid()),
            (gen_random_uuid()),
            (gen_random_uuid()),
            (gen_random_uuid())
          RETURNING id
        `)
        const ids = (inserted as unknown as { id: string }[]).map((r) => r.id)
        const [missing, hiddenOn, alreadyVisible, bothOff] = ids

        await tx.execute(sql`
          INSERT INTO "_m0282_workspace_experiments"
            ("settings_id", "experiment_id", "visible", "enabled")
          VALUES
            (${hiddenOn}::uuid, 'refined-visual-theme', false, true),
            (${alreadyVisible}::uuid, 'refined-visual-theme', true, false),
            (${bothOff}::uuid, 'refined-visual-theme', false, false),
            (${hiddenOn}::uuid, 'other-experiment', false, false)
        `)

        await tx.execute(sql.raw(SCRATCH_SQL))
        await tx.execute(sql.raw(SCRATCH_SQL))

        const rows = await tx.execute<{
          settings_id: string
          experiment_id: string
          visible: boolean
          enabled: boolean
        }>(sql`
          SELECT settings_id, experiment_id, visible, enabled
          FROM "_m0282_workspace_experiments"
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
        expect(refined.every((r) => r.visible === true)).toBe(true)

        const bySettings = new Map(refined.map((r) => [r.settings_id, r.enabled]))
        expect(bySettings.get(missing!)).toBe(false)
        expect(bySettings.get(hiddenOn!)).toBe(true)
        expect(bySettings.get(alreadyVisible!)).toBe(false)
        expect(bySettings.get(bothOff!)).toBe(false)

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
