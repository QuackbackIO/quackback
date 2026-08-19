import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

/**
 * WO-19 — "no old path remains" CI enforcement (structural half, active now).
 *
 * The relay is the sole enqueuer onto the {event-hooks} queue; every other
 * module must go through the process.ts helpers (which the relay calls). This
 * gate fails if any events/ module other than the queue owner constructs a
 * BullMQ Queue or enqueues directly — the load-bearing guard against a
 * reintroduced direct-enqueue path that would bypass deterministic job ids and
 * cause duplicate deliveries. (The complementary "no import of the deleted
 * getHookTargets/legacy dispatch symbols" check activates once WO-18's
 * soak-gated deletion lands.)
 */

// `__dirname` (provided by the test runner) rather than import.meta.url — the
// latter is not guaranteed to be a file: URL under every vitest/bun config, and
// fileURLToPath then throws at load. Mirrors the sibling worker-registry gate.
const EVENTS_DIR = join(__dirname, '..')

/** process.ts owns the queue (ensureQueue/addBulk/enqueueHookJobsWithIds). */
const QUEUE_OWNERS = new Set(['process.ts'])

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

describe('WO-19 enqueue gate', () => {
  it('only the queue owner enqueues onto {event-hooks}', () => {
    const offenders: string[] = []
    for (const file of walk(EVENTS_DIR)) {
      if (QUEUE_OWNERS.has(basename(file))) continue
      const src = readFileSync(file, 'utf8')
      // Match real enqueue CONSTRUCTS (a BullMQ Queue instance / bulk add), not
      // comment references to the queue name — relay.ts documents the pipeline
      // but enqueues only via the process.ts helper.
      const enqueues = /\.addBulk\s*\(/.test(src) || /new Queue\s*\(/.test(src)
      if (enqueues) offenders.push(basename(file))
    }
    expect(offenders).toEqual([])
  })
})
