/**
 * Publish the design a new workspace starts with, so the builder journeys have
 * a published design to edit. The flag stays as the bench left it: the portal
 * journeys measure the portal as the bench data has it, and the builder
 * journeys turn the design engine on for themselves.
 *
 * Usage: bun perf/seed-design.ts           (PERF_DATABASE_URL overrides the target)
 */
import { plugin } from 'bun'
import { BENCH_DATABASE_URL, BENCH_URL } from './config'

// The app's configuration, which reading the database goes through.
process.env.DATABASE_URL = BENCH_DATABASE_URL
process.env.BASE_URL ??= BENCH_URL
process.env.SECRET_KEY ??= 'perf-bench-secret-key-local-and-ci-only-0000'

// The build's font file list, which only a portal page's links read; publishing never does.
plugin({
  name: 'font-manifest',
  setup(build) {
    build.module('virtual:quackback-font-manifest', () => ({
      exports: { default: {} },
      loader: 'object',
    }))
  },
})

const { db, settings } = await import('@/lib/server/db')
const { startingDesign } = await import('@/lib/server/domains/design/starting-design')
const { publishStartingDesign } = await import('@/lib/server/domains/design/design.service')
const { setWords } = await import('@/lib/shared/design/headline-words')

const [row] = await db.select().from(settings).limit(1)
if (!row) throw new Error('No settings row (run the seed first)')
const flags = JSON.parse(row.featureFlags ?? '{}') as Record<string, unknown>
const doc = startingDesign({
  ...row,
  featureFlags: JSON.stringify({ ...flags, portalDesignV2: true }),
})
if (!doc) throw new Error('The bench workspace has custom CSS, so it has no starting design')
// Home's hero with words, for the journey that retypes them where they sit.
setWords(doc, { kind: 'page', page: 'home', part: 'title' }, 'en', 'Help shape what we build next')
setWords(
  doc,
  { kind: 'page', page: 'home', part: 'subtitle' },
  'en',
  'Vote on ideas and follow along'
)
const published = await db.transaction((tx) => publishStartingDesign(tx, doc))
console.log(JSON.stringify({ startingDesign: published ? 'published' : 'kept' }))
process.exit(0)
