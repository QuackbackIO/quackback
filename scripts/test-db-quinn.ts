import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// Use the database package's declared driver, including under isolated installs.
const { default: postgres } = await import(
  createRequire(new URL('../packages/db/package.json', import.meta.url)).resolve('postgres')
)
import { quinnDbSuites, assertSuitePassed } from './quinn-db-test-plan'

const baseUrl = process.env.TEST_DATABASE_URL
if (!baseUrl)
  throw new Error('Set TEST_DATABASE_URL to the PostgreSQL server used for Quinn durability tests')
const suites = quinnDbSuites(baseUrl)
const root = new URL('../', import.meta.url).pathname
const reports = mkdtempSync(join(tmpdir(), 'quinn-db-tests-'))

function run(args: string[], url: string) {
  const child = spawnSync('bun', args, {
    cwd: root,
    env: { ...process.env, TEST_DATABASE_URL: url, DATABASE_URL: url },
    stdio: 'inherit',
  })
  if (child.error) throw child.error
  if (child.status !== 0)
    throw new Error(`Quinn database command failed (${child.status ?? child.signal})`)
}

try {
  if (process.argv.includes('--prepare')) {
    const adminUrl = new URL(baseUrl)
    adminUrl.pathname = '/postgres'
    const admin = postgres(adminUrl.toString(), { max: 1 })
    try {
      for (const [database, url] of new Map(suites.map((s) => [s.database, s.url]))) {
        const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${database}`
        if (!exists.length) await admin.unsafe(`CREATE DATABASE ${database}`)
        run(['run', 'db:migrate'], url)
        // A minimal workspace is required by the committed lifecycle suite.
        const sql = postgres(url, { max: 1 })
        try {
          await sql`INSERT INTO settings (id, name, slug, created_at)
            SELECT gen_random_uuid(), 'Quinn durability', 'quinn-durability', now()
            WHERE NOT EXISTS (SELECT 1 FROM settings)`
        } finally {
          await sql.end()
        }
      }
    } finally {
      await admin.end()
    }
  }
  for (const [index, suite] of suites.entries()) {
    const report = join(reports, `${index}.json`)
    run(
      [
        'x',
        'vitest',
        'run',
        suite.file,
        '--no-file-parallelism',
        '--reporter=default',
        '--reporter=json',
        `--outputFile.json=${report}`,
      ],
      suite.url
    )
    const passed = assertSuitePassed(JSON.parse(readFileSync(report, 'utf8')), suite.file)
    process.stdout.write(`${suite.database}: ${passed} passed, zero skipped (${suite.file})\n`)
  }
} finally {
  rmSync(reports, { recursive: true, force: true })
}
