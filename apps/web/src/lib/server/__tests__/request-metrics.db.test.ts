/**
 * Real-Postgres proof that the app's database handle counts into the active
 * request: the counter is only useful if every statement reaches it.
 */
import { describe, expect, it } from 'vitest'

if (!process.env.BASE_URL?.startsWith('http')) process.env.BASE_URL = 'http://localhost:3000'
process.env.SECRET_KEY ??= 'test-secret-key-with-at-least-32-characters'

import { db, sql } from '@/lib/server/db'
import { currentRequestMetrics, openRequestMetrics } from '../request-metrics'
import { runWithLogContext } from '@/lib/server/log-context'

let available = false
try {
  await db.execute(sql`select 1`)
  available = true
} catch {
  // Local/unit-only runs without Postgres skip this integration proof.
}

describe.skipIf(!available)('request metrics against Postgres', () => {
  it('counts every statement sent through the app database handle', async () => {
    const metrics = await runWithLogContext({ request_id: 'r1' }, async () => {
      openRequestMetrics()
      await db.execute(sql`select 1`)
      await db.transaction(async (tx) => {
        await tx.execute(sql`select 2`)
      })
      return currentRequestMetrics()
    })
    expect(metrics?.dbQueries).toBe(2)
  })
})
