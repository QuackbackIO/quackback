import { describe, it, expect, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

// 0201 adds a nullable status_incident_updates.template_id FK to
// status_incident_templates with ON DELETE SET NULL. The defect it guards:
// an update row carrying a template_id whose template is later deleted must
// NOT block the delete (RESTRICT) nor cascade the update row away — the row
// survives with template_id nulled, so the timeline is never lost and usage
// counts (count(*) group by template_id) simply drop that provenance.
const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
const dbAvailable = !!DB_URL
if (DB_URL) db = createDb(DB_URL, { max: 1 })

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

describe.skipIf(!dbAvailable)('migration 0201 status template usage', () => {
  it('nulls the update row template_id on template delete, keeping the row', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        const template = await tx.execute<{ id: string }>(sql`
          INSERT INTO "status_incident_templates" (id, name, title, body)
          VALUES (gen_random_uuid(), 'M0201 tmpl', 'M0201 title', 'M0201 body')
          RETURNING id
        `)
        const templateId = (template as unknown as { id: string }[])[0].id

        const incident = await tx.execute<{ id: string }>(sql`
          INSERT INTO "status_incidents" (id, kind, title, status, impact, started_at)
          VALUES (gen_random_uuid(), 'incident', 'M0201 incident', 'investigating', 'major', now())
          RETURNING id
        `)
        const incidentId = (incident as unknown as { id: string }[])[0].id

        const update = await tx.execute<{ id: string }>(sql`
          INSERT INTO "status_incident_updates" (id, incident_id, status, body, template_id)
          VALUES (gen_random_uuid(), ${incidentId}, 'investigating', 'M0201 update', ${templateId})
          RETURNING id
        `)
        const updateId = (update as unknown as { id: string }[])[0].id

        // The delete must succeed (ON DELETE SET NULL, not RESTRICT).
        await tx.execute(sql`DELETE FROM "status_incident_templates" WHERE id = ${templateId}`)

        const rows = (await tx.execute<{ id: string; template_id: string | null }>(
          sql`SELECT id, template_id FROM "status_incident_updates" WHERE id = ${updateId}`
        )) as unknown as { id: string; template_id: string | null }[]

        // Row survives; provenance nulled.
        expect(rows).toHaveLength(1)
        expect(rows[0].template_id).toBeNull()

        throw new Error('__ROLLBACK__') // abort so dev/test data is untouched
      })
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== '__ROLLBACK__') throw e
      })
  })
})
