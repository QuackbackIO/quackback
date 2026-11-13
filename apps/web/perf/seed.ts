/**
 * Seed the performance-bench database with the same data on every run.
 *
 * The demo seed draws from Math.random, which would give every bench database a
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
import { LARGE_PROFILE, perfScale } from './config'
import { seedLargeWorkspace } from './seed-large'

// mulberry32: small, fast, and good enough for picking demo data.
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

Math.random = seeded(0x5eed)

const scale = perfScale()
const { seedDone } = await import('../../../packages/db/src/seed.ts')
await seedDone

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
