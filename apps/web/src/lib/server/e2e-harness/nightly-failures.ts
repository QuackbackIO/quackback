/**
 * The nightly e2e triage comment: which jobs of a scheduled CI run failed, and
 * which tests failed in each, read from the Playwright JSON reports the jobs
 * leave behind. `e2e/scripts/nightly-failures.ts` is the CLI the workflow runs.
 *
 * No imports, so the CLI runs under plain `bun` without the app's aliases.
 */

export type JobResult = 'success' | 'failure' | 'cancelled' | 'skipped'

interface ReportTest {
  projectName: string
  status: 'expected' | 'unexpected' | 'flaky' | 'skipped'
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

export interface PlaywrightReport {
  suites?: ReportSuite[]
  errors?: { message?: string }[]
}

export interface FailedTest {
  ids: string[]
  title: string
  project: string
  location: string
}

/** A report, labelled with the job that produced it (e.g. `product-core`). */
export interface LabelledReport {
  label: string
  report: PlaywrightReport
}

export interface NightlySummary {
  /** `failed` when any watched job failed; `cancelled` when none failed but one was cancelled. */
  status: 'failed' | 'green' | 'cancelled'
  body: string
}

/** Jobs that never fail the run by design, so their result says nothing. */
const IGNORED_JOBS = new Set(['e2e-quarantine'])
/** Most tests listed per report; the rest are counted. */
const MAX_LISTED = 40
const JOURNEY_ID = /^(?:[A-Z]+(?:-[A-Z]+)*-\d+\s+)+/

export function failedTests(report: PlaywrightReport): FailedTest[] {
  const out: FailedTest[] = []
  const walk = (suite: ReportSuite, path: string[]) => {
    const here = suite.title && !suite.title.endsWith('.ts') ? [...path, suite.title] : path
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests) {
        if (t.status !== 'unexpected') continue
        const leading = JOURNEY_ID.exec(`${spec.title} `)?.[0] ?? ''
        out.push({
          ids: leading.trim() ? leading.trim().split(/\s+/) : [],
          title: [...here, spec.title].join(' › '),
          project: t.projectName,
          location: `${spec.file}:${spec.line}`,
        })
      }
    }
    for (const child of suite.suites ?? []) walk(child, here)
  }
  for (const suite of report.suites ?? []) walk(suite, [])
  return out
}

/** The job a report belongs to: `product-core-report` and `product-core` share one. */
function reportLabelFor(job: string): string {
  return job.replace(/-report$/, '')
}

export function summarizeNightly(input: {
  jobs: Record<string, { result: JobResult }>
  reports: LabelledReport[]
  runUrl: string
  date: string
}): NightlySummary {
  const watched = Object.entries(input.jobs).filter(([name]) => !IGNORED_JOBS.has(name))
  const failedJobs = watched.filter(([, j]) => j.result === 'failure').map(([name]) => name)
  const cancelledJobs = watched.filter(([, j]) => j.result === 'cancelled').map(([name]) => name)

  if (failedJobs.length === 0) {
    if (cancelledJobs.length > 0) {
      return {
        status: 'cancelled',
        body: `Nightly e2e run ${input.date} was cancelled (${cancelledJobs.join(', ')}): ${input.runUrl}`,
      }
    }
    return {
      status: 'green',
      body: `Nightly e2e ${input.date} is green: ${input.runUrl}`,
    }
  }

  const lines = [
    `## Nightly e2e failures, ${input.date}`,
    '',
    `Run: ${input.runUrl}`,
    '',
    `Failed jobs: ${failedJobs.map((j) => `\`${j}\``).join(', ')}`,
  ]
  if (cancelledJobs.length > 0) {
    lines.push(`Cancelled jobs: ${cancelledJobs.map((j) => `\`${j}\``).join(', ')}`)
  }

  const failedLabels = new Set(failedJobs.map(reportLabelFor))
  const reported = new Set<string>()
  for (const { label, report } of input.reports) {
    const tests = failedTests(report)
    const errors = (report.errors ?? [])
      .map((e) => (e.message ?? '').split('\n')[0])
      .filter(Boolean)
    if (tests.length === 0 && errors.length === 0) continue
    reported.add(label)
    lines.push('', `### ${label}: ${tests.length} failed`, '')
    for (const t of tests.slice(0, MAX_LISTED)) {
      const id = t.ids.length > 0 ? `**${t.ids.join(' ')}** ` : ''
      lines.push(`- ${id}[${t.project}] ${t.title} (\`${t.location}\`)`)
    }
    if (tests.length > MAX_LISTED) lines.push(`- and ${tests.length - MAX_LISTED} more`)
    for (const e of errors.slice(0, 5)) lines.push(`- run error: ${e}`)
  }

  const unreported = [...failedLabels].filter((label) => !reported.has(label)).sort()
  if (unreported.length > 0) {
    lines.push(
      '',
      `No failing tests in a report for: ${unreported.map((j) => `\`${j}\``).join(', ')}. ` +
        'The job failed before or outside its tests (setup, build, timeout); see the run log.'
    )
  }
  return { status: 'failed', body: lines.join('\n') }
}
