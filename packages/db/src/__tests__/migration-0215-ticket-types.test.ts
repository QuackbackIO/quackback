import { describe, it, expect, afterAll } from 'vitest'
import { sql, getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { ticketTypes } from '../schema/ticket-types'
import { tickets } from '../schema/tickets'
import { createDb, type Database } from '../client'

// 0215 creates the ticket_types registry (convergence Phase 4,
// scratchpad/convergence-design.md), adds tickets.ticket_type_id, seeds one
// default type per category from the workspace's CUSTOMIZED intake forms (the
// settings.tickets.ts resolveTicketForms merge — never bare defaults, or
// customized forms would silently revert), and backfills tickets by category.
//
// Isolation mirrors migration-0204: scratch tables + one rolled-back
// transaction per case, so dev/test data is untouched. The seed/backfill
// statement text here must stay in lockstep with 0215_ticket_types.sql.
const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
const dbAvailable = !!DB_URL
if (DB_URL) db = createDb(DB_URL, { max: 1 })

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

// 0215's session-scoped safe reader for the settings.metadata text column.
const SAFE_READER_SQL = sql`
  CREATE FUNCTION pg_temp._m0215_ticket_forms(metadata text) RETURNS jsonb AS $fn$
  BEGIN
    IF metadata IS NULL OR btrim(metadata) = '' THEN RETURN '{}'::jsonb; END IF;
    RETURN metadata::jsonb -> 'ticketForms';
  EXCEPTION WHEN OTHERS THEN RETURN '{}'::jsonb;
  END;
  $fn$ LANGUAGE plpgsql
`

// 0215's seed, pointed at scratch tables (lockstep with the migration).
const SEED_SQL = sql`
  INSERT INTO "_m0215_ticket_types" ("id", "name", "slug", "category", "fields", "is_default", "position", "intake_visible")
  SELECT
    gen_random_uuid(),
    v."name",
    v."slug",
    v."category",
    CASE
      WHEN jsonb_typeof(s."forms" -> v."category") = 'array' THEN s."forms" -> v."category"
      ELSE '[]'::jsonb
    END,
    true,
    0,
    true
  FROM (VALUES
    ('Customer', 'customer', 'customer'),
    ('Back-office', 'back_office', 'back_office'),
    ('Tracker', 'tracker', 'tracker')
  ) AS v("name", "slug", "category")
  LEFT JOIN (
    SELECT pg_temp._m0215_ticket_forms("metadata") AS "forms"
    FROM "_m0215_settings"
    ORDER BY "created_at"
    LIMIT 1
  ) s ON true
`

async function createScratchTables(tx: { execute: (q: unknown) => Promise<unknown> }) {
  await tx.execute(sql`
    CREATE TABLE "_m0215_ticket_types" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" text NOT NULL,
      "slug" text NOT NULL,
      "category" text NOT NULL,
      "fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
      "is_default" boolean DEFAULT false NOT NULL,
      "position" integer DEFAULT 0 NOT NULL,
      "intake_visible" boolean DEFAULT true NOT NULL,
      "deleted_at" timestamptz
    )
  `)
  await tx.execute(sql`
    CREATE TABLE "_m0215_settings" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "metadata" text,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await tx.execute(SAFE_READER_SQL)
}

async function seedAndRead(tx: {
  execute: (q: unknown) => Promise<unknown>
}): Promise<{ name: string; category: string; fields: unknown; is_default: boolean }[]> {
  await tx.execute(SEED_SQL)
  return (await tx.execute(sql`
    SELECT "name", "category", "fields", "is_default" FROM "_m0215_ticket_types" ORDER BY "category"
  `)) as { name: string; category: string; fields: unknown; is_default: boolean }[]
}

describe.skipIf(!dbAvailable)('migration 0215 ticket_types seed + backfill', () => {
  it('seeds each category with the workspace’s CUSTOMIZED form (the merge, not bare defaults)', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        await createScratchTables(tx)
        // A workspace that customized the customer + back_office intake forms
        // (tracker untouched). The customized forms MUST survive the seed.
        const customerForm = [
          {
            key: 'severity',
            label: 'Severity',
            type: 'select',
            required: true,
            visibleToCustomer: true,
            order: 0,
            options: ['Low', 'High'],
          },
        ]
        const backOfficeForm = [
          {
            key: 'risk',
            label: 'Risk',
            type: 'text',
            required: false,
            visibleToCustomer: false,
            order: 0,
          },
        ]
        await tx.execute(sql`
          INSERT INTO "_m0215_settings" ("metadata")
          VALUES (${JSON.stringify({ ticketForms: { customer: customerForm, back_office: backOfficeForm } })})
        `)

        const rows = await seedAndRead(tx)
        expect(rows).toHaveLength(3)
        const byCategory = new Map(rows.map((r) => [r.category, r]))
        expect(byCategory.get('customer')?.fields).toEqual(customerForm)
        expect(byCategory.get('back_office')?.fields).toEqual(backOfficeForm)
        // Untouched category falls back to its default: an empty form.
        expect(byCategory.get('tracker')?.fields).toEqual([])
        // Exactly one seeded type per category, all defaults.
        for (const r of rows) expect(r.is_default).toBe(true)

        throw new Error('__ROLLBACK__')
      })
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== '__ROLLBACK__') throw e
      })
  })

  it('seeds empty forms when the workspace never customized (NULL metadata and no settings row)', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        await createScratchTables(tx)
        await tx.execute(sql`INSERT INTO "_m0215_settings" ("metadata") VALUES (NULL)`)
        const rows = await seedAndRead(tx)
        expect(rows).toHaveLength(3)
        for (const r of rows) expect(r.fields).toEqual([])
        throw new Error('__ROLLBACK__')
      })
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== '__ROLLBACK__') throw e
      })
    await db
      .transaction(async (tx) => {
        // No settings row at all: the LEFT JOIN still yields the three types.
        await createScratchTables(tx)
        const rows = await seedAndRead(tx)
        expect(rows).toHaveLength(3)
        for (const r of rows) expect(r.fields).toEqual([])
        throw new Error('__ROLLBACK__')
      })
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== '__ROLLBACK__') throw e
      })
  })

  it('survives corrupt metadata (the safe reader must not abort the migration)', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        await createScratchTables(tx)
        await tx.execute(sql`INSERT INTO "_m0215_settings" ("metadata") VALUES ('{not json')`)
        const rows = await seedAndRead(tx)
        expect(rows).toHaveLength(3)
        for (const r of rows) expect(r.fields).toEqual([])
        throw new Error('__ROLLBACK__')
      })
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== '__ROLLBACK__') throw e
      })
  })

  it('enforces one live default per category (archived defaults never collide)', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`
          CREATE TABLE "_m0215_types_uq" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "category" text NOT NULL,
            "is_default" boolean DEFAULT false NOT NULL,
            "deleted_at" timestamptz
          )
        `)
        // The migration's partial unique index, verbatim shape.
        await tx.execute(sql`
          CREATE UNIQUE INDEX "_m0215_one_default_uq" ON "_m0215_types_uq" ("category")
          WHERE is_default = true AND deleted_at IS NULL
        `)

        await tx.execute(sql`
          INSERT INTO "_m0215_types_uq" ("category", "is_default") VALUES ('customer', true)
        `)
        // A second LIVE default for the same category violates the index…
        // (inside a savepoint: a rejected statement aborts the whole
        // transaction in Postgres, so probe the violation, roll back to the
        // savepoint, and continue with a clean transaction).
        await tx.execute(sql`SAVEPOINT _m0215_sp`)
        await expect(
          tx.execute(sql`
            INSERT INTO "_m0215_types_uq" ("category", "is_default") VALUES ('customer', true)
          `)
        ).rejects.toThrow()
        await tx.execute(sql`ROLLBACK TO SAVEPOINT _m0215_sp`)
        // …but a default in a DIFFERENT category…
        await tx.execute(sql`
          INSERT INTO "_m0215_types_uq" ("category", "is_default") VALUES ('tracker', true)
        `)
        // …a non-default in the same category…
        await tx.execute(sql`
          INSERT INTO "_m0215_types_uq" ("category", "is_default") VALUES ('customer', false)
        `)
        // …and an ARCHIVED default in the same category all fit.
        await tx.execute(sql`
          INSERT INTO "_m0215_types_uq" ("category", "is_default", "deleted_at")
          VALUES ('customer', true, now())
        `)

        throw new Error('__ROLLBACK__')
      })
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== '__ROLLBACK__') throw e
      })
  })

  it('backfills every ticket to its category’s seeded default type', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        await createScratchTables(tx)
        await tx.execute(SEED_SQL)
        await tx.execute(sql`
          CREATE TABLE "_m0215_tickets" (
            "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "type" text NOT NULL,
            "ticket_type_id" uuid
          )
        `)
        await tx.execute(sql`
          INSERT INTO "_m0215_tickets" ("type") VALUES
            ('customer'), ('customer'), ('back_office'), ('tracker')
        `)

        // 0215's backfill, pointed at scratch tables (lockstep).
        await tx.execute(sql`
          UPDATE "_m0215_tickets" t
          SET "ticket_type_id" = tt."id"
          FROM "_m0215_ticket_types" tt
          WHERE tt."category" = t."type"
            AND tt."is_default" = true
            AND tt."deleted_at" IS NULL
        `)

        const rows = (await tx.execute(sql`
          SELECT t."type", t."ticket_type_id", tt."category" AS "type_category"
          FROM "_m0215_tickets" t
          LEFT JOIN "_m0215_ticket_types" tt ON tt."id" = t."ticket_type_id"
        `)) as { type: string; ticket_type_id: string | null; type_category: string | null }[]

        expect(rows).toHaveLength(4)
        for (const r of rows) {
          expect(r.ticket_type_id).not.toBeNull()
          expect(r.type_category).toBe(r.type)
        }

        throw new Error('__ROLLBACK__')
      })
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== '__ROLLBACK__') throw e
      })
  })
})

// Drizzle-shape guards (0214 style): the TS schema must declare what the SQL
// creates, or db:check-drift fails.
describe('migration 0215 drizzle shape', () => {
  it('ticket_types carries the registry columns', () => {
    const columns = Object.keys(getTableColumns(ticketTypes))
    for (const c of [
      'id',
      'name',
      'slug',
      'category',
      'icon',
      'color',
      'fields',
      'isDefault',
      'position',
      'intakeVisible',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ]) {
      expect(columns).toContain(c)
    }
    expect(getTableColumns(ticketTypes).fields.notNull).toBe(true)
    expect(getTableColumns(ticketTypes).intakeVisible.notNull).toBe(true)
    // Archive-not-delete: the soft-delete column stays nullable.
    expect(getTableColumns(ticketTypes).deletedAt.notNull).toBe(false)
  })

  it('declares the one-default-per-category partial unique index', () => {
    const cfg = getTableConfig(ticketTypes)
    const idx = cfg.indexes.find(
      (i) => i.config.name === 'ticket_types_one_default_per_category_uq'
    )
    expect(idx).toBeDefined()
    expect(idx!.config.unique).toBe(true)
    expect(idx!.config.columns.map((c) => c.name)).toEqual(['category'])
    const chunks = (idx!.config.where as unknown as { queryChunks: { value: unknown }[] })
      .queryChunks
    const where = chunks
      .map((c) => (Array.isArray(c.value) ? c.value.join('') : String(c.value)))
      .join('')
    expect(where).toBe('is_default = true AND deleted_at IS NULL')
  })

  it('tickets carries the nullable ticket_type_id column', () => {
    const columns = getTableColumns(tickets)
    expect(Object.keys(columns)).toContain('ticketTypeId')
    expect(columns.ticketTypeId.notNull).toBe(false)
  })
})
