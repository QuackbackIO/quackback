import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

/**
 * `process.ts` is the sole enqueuer onto the `events` hook queue.
 *
 * That is what makes delivery effectively-once: every job it writes
 * carries a deterministic `<eventId>:<sink>:<target>` dedupe key, so a
 * retried dispatch re-enqueues the same keys and the unique index turns
 * the repeat into a no-op. A module that reached the queue directly
 * would supply no such key, and its jobs would be delivered again on
 * every retry.
 *
 * `emit.ts` writes the `event-dispatch` job in the same transaction as
 * the outbox row — a different queue, same primitive. This gate fails
 * if any other `events/` module imports the job queue's enqueue functions.
 *
 * The construct it names is the one that exists **now**. An earlier version of
 * this gate looked for a BullMQ `Queue` and `addBulk`; the package is banned
 * outright by `policy/no-bullmq`, so those spellings are unreachable and a gate
 * that only looked for them could no longer fail.
 */

// `__dirname` (provided by the test runner) rather than import.meta.url — the
// latter is not guaranteed to be a file: URL under every vitest/bun config, and
// fileURLToPath then throws at load.
const EVENTS_DIR = join(__dirname, '..')

/** The module that owns the queue: name, dedupe key, attempt limit. */
const QUEUE_OWNERS = new Set(['process.ts', 'emit.ts'])

/** An import of the queue's write side, in any of the spellings that reach it. */
const ENQUEUE_IMPORT = /\b(?:enqueueJobs?|cancelJob)\b[^\n]*\bfrom\s+['"][^'"]*jobs\/job-queue['"]/

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue
      out.push(...walk(full))
    } else if (entry.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

function offenders(): string[] {
  const found: string[] = []
  for (const file of walk(EVENTS_DIR)) {
    if (QUEUE_OWNERS.has(basename(file))) continue
    if (ENQUEUE_IMPORT.test(readFileSync(file, 'utf8'))) found.push(basename(file))
  }
  return found
}

describe('the enqueue gate', () => {
  it('only the queue owner writes to the events queue', () => {
    expect(offenders()).toEqual([])
  })

  it('is looking at something, and would name an offender', () => {
    // Without this the case above passes identically when the walk reads
    // nothing at all. Both halves are measured: the folder is really being
    // walked, and the pattern really matches the import it bans.
    const walked = walk(EVENTS_DIR)
    expect(walked.length).toBeGreaterThan(20)
    expect(walked.some((f) => basename(f) === 'event-dispatch-queue.ts')).toBe(true)

    expect(ENQUEUE_IMPORT.test("import { enqueueJob } from '@/lib/server/jobs/job-queue'")).toBe(
      true
    )
    expect(ENQUEUE_IMPORT.test("import { enqueueJobs } from '@/lib/server/jobs/job-queue'")).toBe(
      true
    )
    // The near miss: going through the owner's helper is the sanctioned path.
    expect(ENQUEUE_IMPORT.test("import { enqueueHookJobsWithIds } from './process'")).toBe(false)
  })
})
