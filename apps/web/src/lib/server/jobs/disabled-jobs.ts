/**
 * Jobs an operator has paused with `QUACKBACK_DISABLED_JOBS=name,name`.
 *
 * A paused job is not cancelled. Its schedule writes no row (the same as a shut
 * `cronEnabled` gate), its queued rows stay `pending` with no attempt spent, and
 * neither its rows nor its schedule's deadline wake a parked workspace. Taking
 * the name off the list resumes all of it on the next pass, and the rows that
 * waited run as if they had just been enqueued. A screen that reads a job row
 * therefore shows `pending` as "Queued", never as running.
 *
 * Read from `process.env` directly, like the other job-loop settings in
 * `runner.ts`, so it works in a worker that has not loaded the full config.
 */
import { logger } from '@/lib/server/logger'
import { jobDefinitions, type JobDefinition } from './definitions'

const log = logger.child({ component: 'job-runner' })

export const DISABLED_JOBS_ENV = 'QUACKBACK_DISABLED_JOBS'

export interface ParsedDisabledJobs {
  /** Known job names on the list. */
  paused: ReadonlySet<string>
  /** Names on the list that no job definition carries. Ignored. */
  unknown: string[]
}

/** Split the comma list into known and unknown names. Blank entries are skipped. */
export function parseDisabledJobs(
  raw: string | undefined,
  knownNames: readonly string[]
): ParsedDisabledJobs {
  const known = new Set(knownNames)
  const paused = new Set<string>()
  const unknown: string[] = []
  for (const part of (raw ?? '').split(',')) {
    const name = part.trim()
    if (!name) continue
    if (known.has(name)) paused.add(name)
    else if (!unknown.includes(name)) unknown.push(name)
  }
  return { paused, unknown }
}

/**
 * The last list this process parsed, so the "job paused" lines are written once
 * per process rather than on every pass. Keyed by the raw value and the
 * definition list it was checked against, so a changed list is parsed and
 * reported again.
 */
let parsed: {
  raw: string
  defs: readonly JobDefinition[]
  paused: ReadonlySet<string>
} | null = null

/**
 * The paused job names. The first call in a process, and the first after the
 * list changes, logs one `job paused` line per job and one warning for names
 * that match no job.
 */
export function pausedJobs(): ReadonlySet<string> {
  const raw = process.env[DISABLED_JOBS_ENV] ?? ''
  const defs = jobDefinitions()
  if (parsed && parsed.raw === raw && parsed.defs === defs) return parsed.paused
  const { paused, unknown } = parseDisabledJobs(
    raw,
    defs.map((d) => d.name)
  )
  for (const queue of paused) {
    log.info({ event: 'job.paused', queue }, 'job paused')
  }
  if (unknown.length > 0) {
    log.warn(
      { event: 'job.paused_unknown', unknown, setting: DISABLED_JOBS_ENV },
      'ignoring paused job names that match no job'
    )
  }
  parsed = { raw, defs, paused }
  return paused
}

export function isJobPaused(queue: string): boolean {
  return pausedJobs().has(queue)
}
