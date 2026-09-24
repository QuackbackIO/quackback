/**
 * Build the performance-bench database from scratch: create, migrate, seed
 * with a pinned random generator, then switch on every surface the journeys
 * visit and add the support data the demo seed does not create.
 *
 * Usage: bun perf/setup-db.ts            (PERF_DATABASE_URL overrides the target)
 */
import postgres from 'postgres'
import { BENCH_DATABASE_URL } from './config'

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
console.log(`Bench database ready: ${dbName}`)
