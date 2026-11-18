/**
 * CLI: turn a Playwright JSON report into a Markdown summary for the GitHub
 * job summary.
 *
 * Prints the counts (passed, failed, flaky, skipped) and a table of every
 * test that did not pass cleanly. With `--all`, the table lists every test,
 * which is how the nightly quarantine job shows the state of each
 * quarantined test. The quarantine cause comes from the test's `quarantine`
 * annotation.
 *
 * With `--fail-if-empty`, exits 1 when no real test ran (only setup
 * plumbing), so a sharded run whose grep matched nothing cannot pass as green.
 *
 * Usage: bun summarize-report.ts <report.json> "<heading>" [--all] [--fail-if-empty]
 */
import { readFileSync } from 'node:fs'

interface Annotation {
  type: string
  description?: string
}

interface ReportTest {
  projectName: string
  status: 'expected' | 'unexpected' | 'flaky' | 'skipped'
  annotations: Annotation[]
}

interface ReportSpec {
  title: string
  file: string
  line: number
  tests: ReportTest[]
}

interface ReportSuite {
  title: string
  specs?: ReportSpec[]
  suites?: ReportSuite[]
}

interface Report {
  suites: ReportSuite[]
  stats?: { duration?: number }
}

interface Row {
  file: string
  title: string
  project: string
  status: ReportTest['status']
  cause: string
}

const [reportPath, heading, ...flags] = process.argv.slice(2)
if (!reportPath || !heading) {
  console.error(
    'Usage: bun summarize-report.ts <report.json> "<heading>" [--all] [--fail-if-empty]'
  )
  process.exit(1)
}
const listAll = flags.includes('--all')
const failIfEmpty = flags.includes('--fail-if-empty')
const PLUMBING_PROJECTS = new Set(['setup', 'cleanup', 'support-setup'])

const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report

const rows: Row[] = []
function walk(suite: ReportSuite, path: string[]): void {
  const here = suite.title && !suite.title.endsWith('.ts') ? [...path, suite.title] : path
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests) {
      // The admin sign-in and its teardown are plumbing: report them only when they fail.
      const plumbing = PLUMBING_PROJECTS.has(t.projectName)
      if (plumbing && t.status === 'expected') continue
      rows.push({
        file: `${spec.file}:${spec.line}`,
        title: [...here, spec.title].join(' › '),
        project: t.projectName,
        status: t.status,
        cause: t.annotations.find((a) => a.type === 'quarantine')?.description ?? '',
      })
    }
  }
  for (const child of suite.suites ?? []) walk(child, here)
}
for (const suite of report.suites) walk(suite, [])

const label: Record<Row['status'], string> = {
  expected: 'passed',
  unexpected: 'failed',
  flaky: 'flaky',
  skipped: 'skipped',
}
const count = (status: Row['status']) => rows.filter((r) => r.status === status).length
const minutes = report.stats?.duration
  ? ` in ${(report.stats.duration / 60000).toFixed(1)} min`
  : ''

// Table cells must not break the Markdown row.
const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ')

const lines = [
  `## ${heading}`,
  '',
  `${count('expected')} passed, ${count('unexpected')} failed, ${count('flaky')} flaky, ${count('skipped')} skipped${minutes}.`,
  '',
]
const listed = listAll
  ? rows
  : rows.filter((r) => r.status === 'unexpected' || r.status === 'flaky')
if (listed.length > 0) {
  lines.push('| Result | Test | File | Cause |', '| --- | --- | --- | --- |')
  for (const r of listed) {
    lines.push(
      `| ${label[r.status]} | ${cell(`[${r.project}] ${r.title}`)} | ${cell(r.file)} | ${cell(r.cause)} |`
    )
  }
}
const realTests = rows.filter((r) => !PLUMBING_PROJECTS.has(r.project))
if (failIfEmpty && realTests.length === 0) {
  lines.push('', '**No tests ran.** The run is treated as a failure.')
  console.log(lines.join('\n'))
  process.exit(1)
}
console.log(lines.join('\n'))
