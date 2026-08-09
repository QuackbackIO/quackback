/**
 * A BullMQ `Worker` must not inherit the scope of whoever armed it.
 *
 * A Worker's `run()` loop starts synchronously inside its constructor, so the
 * AsyncLocalStorage context alive at construction becomes the context for every
 * job it ever processes. That store is where `getCurrentTenant()` lives, so a
 * processor reading `db` gets the ARMING tenant's database — for every tenant's
 * jobs, forever, with nothing erroring.
 *
 * Seven queue modules arm lazily on first enqueue and four have no eager init
 * hook at all, while `middleware/request-scope.ts` runs every request inside
 * `runWithTenantScope`. So the arming is request-reachable, and the pooled
 * refusal in `startup.ts` removes only the SAFE (eager, unscoped) path.
 *
 * Three layers are checked here, because each covers a different way the
 * property could come back:
 *
 * 1. the constructor really does capture its context (the leak is real);
 * 2. `createQueueWorker` does not (the mechanism);
 * 3. **no queue module calls `new Worker` directly** (the coverage) — a new
 *    queue added next month is the whole reason §4.4 exists.
 */
import { describe, it, expect, vi } from 'vitest'
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ts from 'typescript'
import { walkSourceFiles } from '@/lib/server/policy/source-files'

// `createQueueWorker` calls `new Worker(...)`; the fake keeps the constructor
// semantics and drops the Redis dependency.
vi.mock('bullmq', async () => {
  const { FakeWorker } = await import('./fake-bullmq')
  return { Worker: FakeWorker }
})

const SERVER_ROOT = join(__dirname, '../..')

/**
 * A queue that a consumer loop awaits, the way BullMQ's `run()` awaits Redis.
 *
 * The mechanism matters and a simpler model gets it wrong: AsyncLocalStorage
 * resolves at CALL time, so a plain closure created inside a scope and invoked
 * later sees nothing. The leak is not closure capture — it is that the run
 * loop's `await` continuations stay rooted in the context the loop was STARTED
 * in. Modelling it with a bare callback array made the first version of this
 * file assert the opposite of the truth, and it failed loudly rather than
 * quietly, which is the only reason it is worth writing down.
 */
function channel<T>() {
  const items: T[] = []
  let wake: (() => void) | null = null
  return {
    push(v: T) {
      items.push(v)
      wake?.()
      wake = null
    },
    async take(): Promise<T> {
      for (;;) {
        const next = items.shift()
        if (next !== undefined) return next
        await new Promise<void>((r) => (wake = r))
      }
    },
  }
}

/** Start a consumer loop; resolves once it has processed `count` jobs. */
function startConsumer(
  jobs: ReturnType<typeof channel<string>>,
  scopeOf: () => string,
  seen: string[],
  count: number
): Promise<void> {
  return new Promise<void>((done) => {
    void (async () => {
      for (let i = 0; i < count; i++) {
        const job = await jobs.take()
        seen.push(`${job}:${scopeOf()}`)
      }
      done()
    })()
  })
}

describe('the leak this seam removes is real', () => {
  it('a run loop STARTED inside a scope keeps it for every job, from any scope', async () => {
    // The measured BullMQ result, reproduced without BullMQ:
    //   Worker constructed inside als.run({tenant:'TENANT-A'})
    //   jobs added from TENANT-B and TENANT-C
    //   -> both processed with scopeSeenByProcessor = TENANT-A
    const als = new AsyncLocalStorage<{ tenant: string }>()
    const scopeOf = () => als.getStore()?.tenant ?? 'none'
    const jobs = channel<string>()
    const seen: string[] = []

    const finished = als.run({ tenant: 'TENANT-A' }, () => startConsumer(jobs, scopeOf, seen, 2))
    als.run({ tenant: 'TENANT-B' }, () => jobs.push('B-job'))
    als.run({ tenant: 'TENANT-C' }, () => jobs.push('C-job'))
    await finished

    expect(seen).toEqual(['B-job:TENANT-A', 'C-job:TENANT-A'])
  })

  it('…and starting the same loop detached leaves it with no scope at all', async () => {
    const als = new AsyncLocalStorage<{ tenant: string }>()
    const scopeOf = () => als.getStore()?.tenant ?? 'none'
    const jobs = channel<string>()
    const seen: string[] = []

    const finished = als.run({ tenant: 'TENANT-A' }, () =>
      // `als.exit` is what `runWithoutLogContext` does to the logger store.
      als.exit(() => startConsumer(jobs, scopeOf, seen, 2))
    )
    als.run({ tenant: 'TENANT-B' }, () => jobs.push('B-job'))
    als.run({ tenant: 'TENANT-C' }, () => jobs.push('C-job'))
    await finished

    // No tenant at all, rather than the wrong one. A processor that reaches
    // `db` under pooled tenancy then throws TenantScopeMissingError — the job
    // fails loudly and retries instead of succeeding against a stranger.
    expect(seen).toEqual(['B-job:none', 'C-job:none'])
  })
})

describe('createQueueWorker detaches the REAL tenant store', () => {
  // Calls the PRODUCTION function, not a hand-rolled equivalent. The round-3
  // first draft of this block wrapped `runWithoutLogContext` by hand and never
  // imported `createQueueWorker` — so removing the detach from the seam left it
  // 6/6 green. That is the same defect this round was dispatched to fix, one
  // file over, and the falsification harness caught it rather than review.
  //
  // `bullmq` is faked so no Redis is needed, but the fake reproduces the one
  // property that matters: the constructor starts the consumer loop, so the
  // loop's continuations inherit whatever context constructed it.
  it('CONTROL: the fake Worker really does inherit its constructing scope', async () => {
    const { withTenant } = await import('@/lib/server/__tests__/tenant-scope')
    const { getCurrentTenant } = await import('@/lib/server/tenancy/tenant-context')
    const { FakeWorker, resetFakeWorkers } = await import('./fake-bullmq')
    resetFakeWorkers()

    const seen: string[] = []
    const worker = withTenant(
      'tenant-alpha',
      () => new FakeWorker('q', async () => seen.push(getCurrentTenant()?.tenantId ?? 'none'))
    )
    await withTenant('tenant-bravo', () => worker.deliver())

    // bravo's job, alpha's database. Without this the assertion below could
    // pass on a fake that never propagated anything.
    expect(seen).toEqual(['tenant-alpha'])
  })

  it('a Worker built through createQueueWorker processes with no tenant', async () => {
    const { withTenant } = await import('@/lib/server/__tests__/tenant-scope')
    const { getCurrentTenant } = await import('@/lib/server/tenancy/tenant-context')
    const { resetFakeWorkers, lastFakeWorker } = await import('./fake-bullmq')
    const { createQueueWorker } = await import('../create-worker')
    resetFakeWorkers()

    const seen: string[] = []
    withTenant('tenant-alpha', () =>
      createQueueWorker(
        'q',
        async () => {
          seen.push(getCurrentTenant()?.tenantId ?? 'none')
        },
        {} as never
      )
    )
    await withTenant('tenant-bravo', () => lastFakeWorker().deliver())

    expect(seen).toEqual(['none'])
  })
})

/** Every `new Worker(` in server source, by file. */
function directWorkerConstructions(): string[] {
  const offenders: string[] = []
  for (const file of walkSourceFiles(SERVER_ROOT)) {
    if (!file.endsWith('.ts')) continue
    if (file.endsWith('create-worker.ts')) continue
    const text = readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
    const visit = (node: ts.Node): void => {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'Worker'
      ) {
        offenders.push(file.slice(file.indexOf('lib/server')))
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return offenders
}

describe('coverage: nothing constructs a Worker outside the seam', () => {
  it('finds no direct `new Worker(...)` in server code', () => {
    // The fifteen queue modules go through `createQueueWorker`. This is what
    // stops the sixteenth from quietly reintroducing the inheritance — the
    // mechanism tests above would stay green while a new queue leaked.
    expect(directWorkerConstructions()).toEqual([])
  })

  it('is looking at something: the queue modules are in scope and use the seam', () => {
    // A source scan that scanned nothing would satisfy the assertion above.
    let usingSeam = 0
    for (const file of walkSourceFiles(SERVER_ROOT)) {
      if (!file.endsWith('.ts')) continue
      if (/\bcreateQueueWorker\s*[(<]/.test(readFileSync(file, 'utf8'))) usingSeam += 1
    }
    expect(usingSeam).toBeGreaterThanOrEqual(15)
  })
})

describe('under pooled tenancy no BullMQ worker is constructed at all', () => {
  // The refusal that used to live in the config schema as "pooled requires
  // QUACKBACK_ROLE=web". That banned the role, and the role is exactly what the
  // pooled job tier needs — the two guards composed into a fleet with no
  // runnable configuration. It belongs here, on the noun it was about.
  async function load(pooled: boolean) {
    vi.resetModules()
    vi.doMock('@/lib/server/tenancy/mode', () => ({
      isPooledTenancy: () => pooled,
      POOLED_TENANCY: 'pooled',
    }))
    vi.doMock('bullmq', async () => {
      const { FakeWorker } = await import('./fake-bullmq')
      return { Worker: FakeWorker }
    })
    const mod = await import('../create-worker')
    mod.__resetQueueWorkerRefusals()
    return mod
  }

  it('returns null under pooled tenancy', async () => {
    const { createQueueWorker } = await load(true)
    expect(createQueueWorker('q', async () => {}, {} as never)).toBeNull()
  })

  it('CONTROL: still constructs one under single tenancy', async () => {
    // Without this, "returns null" would pass on a function that returns null
    // unconditionally — and the fifteen queue modules would silently lose their
    // consumers on every self-hosted install.
    const { createQueueWorker } = await load(false)
    expect(createQueueWorker('q', async () => {}, {} as never)).not.toBeNull()
  })

  it('refuses whatever the role says, because the role is not the question', async () => {
    for (const role of ['web', 'worker', 'all']) {
      process.env.QUACKBACK_ROLE = role
      const { createQueueWorker } = await load(true)
      expect(
        createQueueWorker('q', async () => {}, {} as never),
        role
      ).toBeNull()
    }
    delete process.env.QUACKBACK_ROLE
  })

  it('logs the refusal once per queue, not once per call', async () => {
    const lines: string[] = []
    vi.resetModules()
    vi.doMock('@/lib/server/tenancy/mode', () => ({
      isPooledTenancy: () => true,
      POOLED_TENANCY: 'pooled',
    }))
    vi.doMock('@/lib/server/logger', () => ({
      logger: { child: () => ({ error: (_c: unknown, m: string) => lines.push(m) }) },
    }))
    const { createQueueWorker, __resetQueueWorkerRefusals } = await import('../create-worker')
    __resetQueueWorkerRefusals()

    createQueueWorker('alpha', async () => {}, {} as never)
    createQueueWorker('alpha', async () => {}, {} as never)
    createQueueWorker('bravo', async () => {}, {} as never)

    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('refusing to construct a BullMQ worker')
    vi.resetModules()
  })
})
