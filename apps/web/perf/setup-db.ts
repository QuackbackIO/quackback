/**
 * Build the performance-bench database from scratch: create, migrate, seed
 * with a pinned random generator, then switch on every surface the journeys
 * visit and add the support data the demo seed does not create. For the
 * designed suite (PERF_SUITE=designed), also the design engine and the
 * designed portals' preview links (perf/designs.ts).
 *
 * Usage: bun perf/setup-db.ts            (PERF_DATABASE_URL overrides the target)
 *        PERF_SUITE=designed bun perf/setup-db.ts
 */
import postgres from 'postgres'
import { BENCH_DATABASE_URL, BENCH_SUITE } from './config'

const target = new URL(BENCH_DATABASE_URL)
const dbName = target.pathname.slice(1)
const admin = new URL(target)
admin.pathname = '/postgres'

const root = new URL('../../../', import.meta.url).pathname
const env = { ...process.env, DATABASE_URL: BENCH_DATABASE_URL }

function run(label: string, cmd: string[], cwd = root): string {
  process.stdout.write(`- ${label}\n`)
  const proc = Bun.spawnSync(cmd, { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  if (proc.exitCode !== 0) {
    process.stderr.write(proc.stdout.toString() + proc.stderr.toString())
    throw new Error(`${label} failed (exit ${proc.exitCode})`)
  }
  return proc.stdout.toString()
}

const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} })
await sql.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
await sql.unsafe(`CREATE DATABASE "${dbName}"`)
await sql.end()

const scripts = 'apps/web/e2e/scripts'
run('migrate', ['bun', 'run', '--cwd', 'packages/db', 'db:migrate'])
run('seed (pinned generator)', ['bun', 'apps/web/perf/seed.ts'])
run('enable widget, support, help center and changelog', [
  'bun',
  `${scripts}/set-widget-surfaces.ts`,
  'on',
])
run('seed identified-customer fixtures', ['bun', `${scripts}/seed-widget-identified.ts`])
for (let i = 1; i <= 5; i++) {
  run(`seed conversation ${i}`, [
    'bun',
    `${scripts}/seed-conversation.ts`,
    `Bench conversation ${i}`,
  ])
}
if (BENCH_SUITE === 'designed') {
  // The designed suite publishes nothing: its portal pages draw the branding converted.
  run('turn the design engine on, with a preview link per designed portal', [
    'bun',
    'apps/web/perf/seed-designs.ts',
  ])
} else {
  // A published design for the builder journeys to edit. The design engine stays
  // off for every other journey; the builder journeys turn it on for themselves.
  run('publish the starting design', ['bun', 'apps/web/perf/seed-design.ts'])
}
console.log(`Bench database ready: ${dbName}`)
