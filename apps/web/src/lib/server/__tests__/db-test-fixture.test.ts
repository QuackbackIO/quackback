import { expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { createDbTestFixture } from './db-test-fixture'

it('fails a reachable database with a stale schema and names the missing column and repair', async () => {
  const fixture = createDbTestFixture({
    probe: async (db) => {
      await db.execute(sql`SELECT quinn_required_column FROM (SELECT 1 AS present) probe`)
    },
  })
  await expect(fixture).rejects.toThrow(/quinn_required_column/)
  await expect(fixture).rejects.toThrow(/DATABASE_URL=.*bun run db:migrate/)
})
