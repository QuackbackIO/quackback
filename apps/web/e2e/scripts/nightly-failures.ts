/**
 * CLI: build the nightly e2e triage comment from a CI run's job results and
 * the Playwright JSON reports its jobs left behind.
 *
 * Writes the comment body to <out> and prints `status=failed|green|cancelled`
 * (for $GITHUB_OUTPUT). The workflow then opens or comments on the
 * "Nightly e2e failures" issue.
 *
 * Usage: bun nightly-failures.ts <needs.json> <reports-dir> <out.md>
 *   needs.json   `${{ toJSON(needs) }}` from the workflow
 *   reports-dir  directory of <job-label>.json Playwright JSON reports
 *
 * Env: RUN_URL, RUN_DATE (YYYY-MM-DD).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  summarizeNightly,
  type JobResult,
  type LabelledReport,
} from '../../src/lib/server/e2e-harness/nightly-failures'

const [needsPath, reportsDir, outPath] = process.argv.slice(2)
if (!needsPath || !reportsDir || !outPath) {
  console.error('Usage: bun nightly-failures.ts <needs.json> <reports-dir> <out.md>')
  process.exit(1)
}

const jobs = JSON.parse(readFileSync(needsPath, 'utf8')) as Record<string, { result: JobResult }>
const reports: LabelledReport[] = []
if (existsSync(reportsDir)) {
  for (const name of readdirSync(reportsDir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    try {
      reports.push({
        label: basename(name, '.json').replace(/-results$/, ''),
        report: JSON.parse(readFileSync(join(reportsDir, name), 'utf8')),
      })
    } catch (error) {
      console.error(`Skipping unreadable report ${name}: ${String(error)}`)
    }
  }
}

const summary = summarizeNightly({
  jobs,
  reports,
  runUrl: process.env.RUN_URL ?? '(run URL unknown)',
  date: process.env.RUN_DATE ?? new Date().toISOString().slice(0, 10),
})
writeFileSync(outPath, `${summary.body}\n`)
console.log(`status=${summary.status}`)
