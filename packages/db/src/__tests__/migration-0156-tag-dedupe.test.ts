import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Database } from '../client'

// 0156 adds a case-insensitive unique index on conversation_tags.name. Existing
// case-variant duplicates ("VIP" / "vip") would break the index, so the migration
// dedupes first: the OLDEST row per lower(name) is the keeper, assignments are
// repointed onto it (skipping conversations that already hold it), a soft-deleted
// keeper absorbing a live duplicate is resurrected, and the duplicate rows are
// removed. This pins that keep-oldest + repoint behavior; the index DDL itself is
// pinned by schema-conversation-attributes.test.ts.
const DEDUPE_SQL = readFileSync(
  join(__dirname, '../../drizzle/0156_conversation_attributes.sql'),
  'utf8'
)
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter(Boolean)
  // Only the tag-dedupe statements: the attribute-definitions CREATE TABLE (and
  // its index) must not re-run against a DB that already applied 0156.
  .filter((s) => s.includes('conversation_tag'))

const DB_URL = process.env.DATABASE_URL
let db: Database | null = null
const dbAvailable = !!DB_URL
if (DB_URL) db = createDb(DB_URL, { max: 1 })

afterAll(async () => {
  // @ts-expect-error optional teardown
  await db?.$client?.end?.()
})

async function seedConversation(tx: Parameters<Parameters<Database['transaction']>[0]>[0]) {
  const principal = await tx.execute<{ id: string }>(sql`
    INSERT INTO "principal" (id, role, type, created_at)
    VALUES (gen_random_uuid(), 'user', 'anonymous', now())
    RETURNING id
  `)
  const principalId = (principal as unknown as { id: string }[])[0].id
  const conversation = await tx.execute<{ id: string }>(sql`
    INSERT INTO "conversations" (id, visitor_principal_id, channel)
    VALUES (gen_random_uuid(), ${principalId}, 'messenger')
    RETURNING id
  `)
  return (conversation as unknown as { id: string }[])[0].id
}

describe.skipIf(!dbAvailable)('migration 0156 conversation tag dedupe', () => {
  it('keeps the oldest tag per lower(name), repoints assignments, and resurrects a soft-deleted keeper', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        // The index exists once 0156 is applied; drop it inside the rolled-back
        // transaction so the case-variant seed rows can be inserted.
        await tx.execute(sql.raw('DROP INDEX IF EXISTS "conversation_tags_name_lower_key"'))

        const conv1 = await seedConversation(tx)
        const conv2 = await seedConversation(tx)

        // Oldest ("M0156-VIP", soft-deleted) is the keeper; two live case
        // variants collide with it. Unique suffixed names avoid clashing with
        // real dev-data tags.
        const tags = await tx.execute<{ id: string }>(sql`
          INSERT INTO "conversation_tags" (id, name, color, created_at, deleted_at)
          VALUES
            (gen_random_uuid(), 'M0156-VIP', '#111111', now() - interval '3 days', now()),
            (gen_random_uuid(), 'm0156-vip', '#222222', now() - interval '2 days', NULL),
            (gen_random_uuid(), 'M0156-Vip', '#333333', now() - interval '1 day', NULL)
          RETURNING id
        `)
        const [keeper, dupA, dupB] = (tags as unknown as { id: string }[]).map((t) => t.id)

        // conv1 holds BOTH live duplicates (repoint must collapse them to one
        // keeper assignment); conv2 holds one duplicate.
        await tx.execute(sql`
          INSERT INTO "conversation_tag_assignments" (conversation_id, conversation_tag_id)
          VALUES (${conv1}, ${dupA}), (${conv1}, ${dupB}), (${conv2}, ${dupB})
        `)

        for (const stmt of DEDUPE_SQL) {
          await tx.execute(sql.raw(stmt))
        }

        const remaining = await tx.execute<{ id: string; name: string; deleted_at: string | null }>(
          sql`SELECT id, name, deleted_at FROM "conversation_tags" WHERE lower(name) = 'm0156-vip'`
        )
        const rows = remaining as unknown as {
          id: string
          name: string
          deleted_at: string | null
        }[]
        expect(rows).toHaveLength(1)
        expect(rows[0].id).toBe(keeper) // oldest row wins
        expect(rows[0].name).toBe('M0156-VIP')
        expect(rows[0].deleted_at).toBeNull() // resurrected: it absorbed live duplicates

        const assignments = await tx.execute<{
          conversation_id: string
          conversation_tag_id: string
        }>(
          sql`SELECT conversation_id, conversation_tag_id FROM "conversation_tag_assignments"
              WHERE conversation_id IN (${conv1}, ${conv2})
              ORDER BY conversation_id`
        )
        const assigned = assignments as unknown as {
          conversation_id: string
          conversation_tag_id: string
        }[]
        // conv1's two duplicate assignments collapse to ONE keeper assignment.
        expect(assigned).toHaveLength(2)
        expect(assigned.every((a) => a.conversation_tag_id === keeper)).toBe(true)
        expect(new Set(assigned.map((a) => a.conversation_id))).toEqual(new Set([conv1, conv2]))

        throw new Error('__ROLLBACK__') // abort the tx so dev/test data is untouched
      })
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== '__ROLLBACK__') throw e
      })
  })

  it('leaves a keeper soft-deleted when every duplicate is also soft-deleted', async () => {
    if (!db) return
    await db
      .transaction(async (tx) => {
        await tx.execute(sql.raw('DROP INDEX IF EXISTS "conversation_tags_name_lower_key"'))

        await tx.execute(sql`
          INSERT INTO "conversation_tags" (id, name, color, created_at, deleted_at)
          VALUES
            (gen_random_uuid(), 'M0156-Spam', '#111111', now() - interval '2 days', now()),
            (gen_random_uuid(), 'm0156-spam', '#222222', now() - interval '1 day', now())
        `)

        for (const stmt of DEDUPE_SQL) {
          await tx.execute(sql.raw(stmt))
        }

        const remaining = await tx.execute<{ name: string; deleted_at: string | null }>(
          sql`SELECT name, deleted_at FROM "conversation_tags" WHERE lower(name) = 'm0156-spam'`
        )
        const rows = remaining as unknown as { name: string; deleted_at: string | null }[]
        expect(rows).toHaveLength(1)
        expect(rows[0].name).toBe('M0156-Spam')
        expect(rows[0].deleted_at).not.toBeNull() // no live duplicate — stays archived

        throw new Error('__ROLLBACK__')
      })
      .catch((e) => {
        if (!(e instanceof Error) || e.message !== '__ROLLBACK__') throw e
      })
  })
})
