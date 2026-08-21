/**
 * That priming actually happens.
 *
 * `handler-imports.test.ts` is a source scan: it proves the handler modules
 * *can* be loaded statically. It says nothing about whether anything loads them
 * before a workspace scope opens — and that gap is not hypothetical. With
 * `primeJobHandlers()` gutted to a no-op the whole suite stayed green, because
 * `resolveHandler` would simply import the wrapper at first-job time instead,
 * inside the per-pass workspace scope. The static hoist makes that *worse*, not
 * better: the entire 190-file handler graph would then load under whichever
 * workspace's job ran first.
 *
 * Same shape as the `attempted` counter one layer up — a property everything
 * agreed about and nothing pinned. So this file counts loads.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanupQueues, closeHarness, ensureJobQueueSchema, testDb, uniqueQueue } from './harness'

vi.mock('@/lib/server/db', () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        const handle = testDb()
        const value = Reflect.get(handle as object, prop, handle)
        return typeof value === 'function' ? value.bind(handle) : value
      },
    }
  ),
}))

let currentWorkspaceKey: string | null = null
vi.mock('@/lib/server/workspaces/workspace-context', () => ({
  getCurrentWorkspace: () =>
    currentWorkspaceKey === null ? null : { workspaceKey: currentWorkspaceKey },
}))

// The in-scope warning is a diagnostic, and a diagnostic nothing reads is a
// diagnostic that can be deleted. Capture it.
const warnings: unknown[][] = []
const errors: unknown[][] = []
vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      warn: (...a: unknown[]) => warnings.push(a),
      error: (...a: unknown[]) => errors.push(a),
      info: () => {},
      debug: () => {},
    }),
  },
}))

import { __setJobDefinitionsForTests } from '../definitions'
import { claimJobs, enqueueJob } from '../job-queue'
import { primeJobHandlers, resetJobHandlers, runJob } from '../runner'

const created: string[] = []

/** A definition list whose handlers record every time they are loaded. */
function countingDefs(names: string[]): { loads: string[] } {
  const loads: string[] = []
  __setJobDefinitionsForTests(
    names.map((name) => ({
      name,
      maxAttempts: 1,
      leaseMs: 30_000,
      handler: async () => {
        loads.push(name)
        return async () => {}
      },
    }))
  )
  return { loads }
}

function queue(label: string): string {
  const q = uniqueQueue(label)
  created.push(q)
  return q
}

beforeAll(async () => {
  await ensureJobQueueSchema()
})

afterEach(() => {
  currentWorkspaceKey = null
  __setJobDefinitionsForTests(null)
  resetJobHandlers()
  warnings.length = 0
  errors.length = 0
})

afterAll(async () => {
  await cleanupQueues(created)
  await closeHarness()
})

describe('primeJobHandlers', () => {
  it('loads every registered handler exactly once', async () => {
    const a = queue('prime-a')
    const b = queue('prime-b')
    const { loads } = countingDefs([a, b])

    await primeJobHandlers()

    // The assertion that a no-op prime cannot satisfy.
    expect(loads.sort()).toEqual([a, b].sort())
  })

  it('does not reload on a second prime', async () => {
    const a = queue('prime-twice')
    const { loads } = countingDefs([a])
    await primeJobHandlers()
    await primeJobHandlers()
    expect(loads).toEqual([a])
  })

  it('refuses to prime inside a workspace scope, and says so', async () => {
    // Priming under a scope would defeat its own purpose silently — the modules
    // would load under that workspace, which is the thing being prevented.
    const a = queue('prime-scoped')
    const { loads } = countingDefs([a])
    currentWorkspaceKey = 'inst_alpha'

    await primeJobHandlers()

    expect(loads).toEqual([])
    expect(errors.flat().join(' ')).toMatch(/inside a workspace scope/)
  })
})

describe('running a job does not import anything', () => {
  it('reuses the primed handler rather than loading it again', async () => {
    const q = queue('prime-run')
    const { loads } = countingDefs([q])
    await primeJobHandlers()
    expect(loads).toEqual([q])

    await enqueueJob({ queue: q, maxAttempts: 1 })
    const [job] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: 30_000 }] })
    expect(await runJob(job)).toBe('succeeded')

    // The assertion that a `resolveHandler` ignoring its memo cannot satisfy:
    // the handler was loaded once, at prime time, and not again for the job.
    expect(loads).toEqual([q])
  })

  it('warns when it has to load a handler under a workspace scope', async () => {
    // The fallback path. It must work — a direct `runJob` in a test has never
    // primed — but in a running tier it means a module is being imported under
    // a workspace's connection, so it must not be silent.
    const q = queue('prime-miss')
    const { loads } = countingDefs([q])

    // Stamp and claim under the same workspace, or the claim's own workspace
    // assertion refuses the row and the handler is never reached — a fixture
    // that never arrives at the branch it asserts about. The guard below is for
    // DIAGNOSIS, not detection: `runJob(undefined)` throws either way, so the
    // broken fixture fails regardless. What the guard buys is that it fails as
    // a named fixture fault rather than as a TypeError a future reader would
    // plausibly "fix" with an optional chain.
    currentWorkspaceKey = 'inst_alpha'
    await enqueueJob({ queue: q, maxAttempts: 1 })
    const [job] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: 30_000 }] })
    expect(
      job,
      'the claim must reach the handler for this assertion to mean anything'
    ).toBeDefined()
    expect(await runJob(job)).toBe('succeeded')

    expect(loads).toEqual([q])
    expect(warnings.flat().join(' ')).toMatch(/imported inside a workspace scope/)
  })

  it('does not warn when there is no scope to capture', async () => {
    const q = queue('prime-miss-unscoped')
    countingDefs([q])
    await enqueueJob({ queue: q, maxAttempts: 1 })
    const [job] = await claimJobs({ specs: [{ queue: q, limit: 1, leaseMs: 30_000 }] })
    await runJob(job)
    expect(warnings.flat().join(' ')).not.toMatch(/imported inside a workspace scope/)
  })
})
