/**
 * Seed the performance-bench database with the same data on every run.
 *
 * Unpinned, the demo seed draws from Math.random, which would give every bench database a
 * different number of comments, votes and tags per post, and with them a
 * different number of rows for each page to render. Pinning the generator makes
 * the counts the bench compares reproducible.
 *
 * `PERF_SCALE=large` then adds a busy install's support data (`seed-large.ts`),
 * for reading query and migration plans at size.
 *
 * Usage: DATABASE_URL=... bun perf/seed.ts
 *        DATABASE_URL=... PERF_SCALE=large bun perf/seed.ts
 */
import postgres from 'postgres'
import { BENCH_DOMAIN, LARGE_PROFILE, perfScale } from './config'
import { seedLargeWorkspace } from './seed-large'

// The demo seed draws from its own generator when SEED_RANDOM is set. This file
// used to replace Math.random, which the postgres driver also calls: version 3
// took 23 draws before the seed's first one (a statement id and a lifetime for
// each of its 10 connections, then one on connecting), version 4 takes 4, so the
// data changed with the driver. Skipping 23 keeps the data, and with it the
// counts in budgets.json, exactly as they were.
process.env.SEED_RANDOM = String(0x5eed)
process.env.SEED_RANDOM_SKIP = '23'

const scale = perfScale()
const { seedDone } = await import('../../../packages/db/src/seed.ts')
await seedDone

// One domain added by name, with no use yet, so its own page has a sweep.
if (!process.exitCode) {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    await sql`
      INSERT INTO domains (id, name, ownership_token)
      VALUES (gen_random_uuid(), ${BENCH_DOMAIN}, '0f1e2d3c4b5a69788796a5b4c3d2e1f0')
      ON CONFLICT (name) DO NOTHING`
  } finally {
    await sql.end()
  }
}

if (scale === 'large' && !process.exitCode) {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  process.stdout.write('Seeding the large profile...\n')
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    await seedLargeWorkspace(sql, LARGE_PROFILE)
  } finally {
    await sql.end()
  }
}
