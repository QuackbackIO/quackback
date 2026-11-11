/**
 * The designed suite's database: the portal on the design engine (the switch
 * every new workspace starts with), and a shared preview link for each bench
 * design (perf/designs.ts), with its fixed token. Nothing is published, so
 * the portal's own pages draw its branding converted, as a new workspace's do.
 *
 * Usage: DATABASE_URL=... bun perf/seed-designs.ts
 */
import { createHash, randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { readStoredDesign } from '../src/lib/shared/design/stored-design'
import {
  BENCH_DESIGNS,
  PREVIEW_ONLY_DESIGNS,
  benchDesignDocument,
  benchDesignToken,
} from './designs'

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
try {
  await sql`
    UPDATE settings
    SET feature_flags = (coalesce(nullif(feature_flags, ''), '{}')::jsonb
      || '{"portalDesignV2": true}')::text`
  await sql`INSERT INTO portal_designs (id) VALUES (${randomUUID()}) ON CONFLICT DO NOTHING`
  const [design] = await sql<{ id: string }[]>`
    SELECT id FROM portal_designs WHERE site_id IS NULL`
  for (const name of [...BENCH_DESIGNS, ...PREVIEW_ONLY_DESIGNS]) {
    const document = benchDesignDocument(name)
    const read = readStoredDesign(document)
    if (!read || read.dropped.length) throw new Error(`${name} does not read as a design`)
    const tokenHash = createHash('sha256').update(benchDesignToken(name)).digest('hex')
    await sql`
      INSERT INTO portal_design_preview_links (id, design_id, token_hash, document, expires_at)
      VALUES (${randomUUID()}, ${design!.id}, ${tokenHash}, ${sql.json(document as never)},
              '2100-01-01T00:00:00Z')
      ON CONFLICT (token_hash) DO UPDATE SET document = EXCLUDED.document`
  }
  console.log(`Preview links for ${[...BENCH_DESIGNS, ...PREVIEW_ONLY_DESIGNS].join(', ')}`)
} finally {
  await sql.end()
}
