import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { createDb } from '../client'

const migration = readFileSync(
  new URL('../../drizzle/0312_personal_key_reply_cutoff.sql', import.meta.url),
  'utf8'
)

const KEY = 'api-keys:personal-reply-cutoff'

it('records the personal-key cutoff once, far out, and a replay never moves it', async () => {
  const db = createDb(
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test',
    { max: 1 }
  )
  const rollback = new Error('owned migration fixture rollback')
  try {
    await db.transaction(async (tx) => {
      // As on an install reaching this release for the first time.
      await tx.execute(sql`DELETE FROM kv_store WHERE key = ${KEY}`)
      await tx.execute(sql.raw(migration))
      const [first] = await tx.execute(
        sql`SELECT value #>> '{}' AS cutoff, expires_at > now() + interval '99 years' AS far
            FROM kv_store WHERE key = ${KEY}`
      )
      expect(first.far).toBe(true)
      expect(Number.isNaN(new Date(String(first.cutoff)).getTime())).toBe(false)

      // A replay later on (the fleet gap-heal) must keep the first cutoff, or
      // keys made in between would turn automated.
      const earlier = '2025-01-01T00:00:00+00:00'
      await tx.execute(
        sql`UPDATE kv_store SET value = to_jsonb(${earlier}::text) WHERE key = ${KEY}`
      )
      await tx.execute(sql.raw(migration))
      const rows = await tx.execute(
        sql`SELECT value #>> '{}' AS cutoff FROM kv_store WHERE key = ${KEY}`
      )
      expect(rows.map((r) => r.cutoff)).toEqual([earlier])
      throw rollback
    })
  } catch (err) {
    if (err !== rollback) throw err
  } finally {
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end()
  }
})
