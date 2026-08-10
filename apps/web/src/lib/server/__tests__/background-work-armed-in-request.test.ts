/**
 * Process-lifetime work armed from inside a request.
 *
 * `functions/bootstrap.ts` starts telemetry from a `setTimeout` scheduled while
 * serving the pod's first page. AsyncLocalStorage carries that request's store
 * into the timer, into `startTelemetry`, and into the hourly `setInterval` it
 * arms — for the life of the process.
 *
 * Under pooled tenancy the store also carries the **workspace scope**, and
 * `withSweepLock` fans a tick across the fleet only `if (isPooledTenancy() &&
 * !getWorkspaceScope())`. So an inherited scope means it never fans out: whichever
 * workspace rendered the first page owns the fleet's telemetry forever — an hourly
 * claim in *its* database, no ping for anyone else, and `telemetry/instance-id.ts`
 * repeatedly issuing an unlocked read-modify-write of *its* `settings.metadata`,
 * which is the write SAAS-HOSTING-STACK.md §3 names as able to drop the
 * fingerprint stamp.
 *
 * Three cases, and the first is what makes the other two mean anything: it
 * proves the leak is real, so "no scope in the timer" is a property of the fix
 * rather than of AsyncLocalStorage not propagating in the first place.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ts from 'typescript'

const hoisted = vi.hoisted(() => ({
  fleetPasses: 0,
  locksTakenInScope: [] as (string | null)[],
  pooled: true,
}))

vi.mock('@/lib/server/workspaces/mode', () => ({
  isPooledTenancy: () => hoisted.pooled,
  POOLED_TENANCY: 'pooled',
}))

vi.mock('@/lib/server/workspaces/fleet', () => ({
  runFleetPass: async (_origin: string, body: () => Promise<void>) => {
    hoisted.fleetPasses += 1
    await body()
    return { succeeded: 1, failed: 0, skipped: 0 }
  },
}))

vi.mock('@/lib/server/db', async () => {
  const { getCurrentWorkspace } = await import('@/lib/server/workspaces/workspace-context')
  return {
    db: {
      execute: async () => {
        // Where the lock is actually taken, and under which workspace.
        hoisted.locksTakenInScope.push(getCurrentWorkspace()?.workspaceKey ?? null)
        return [{ name: 'telemetry_ping', acquired_at: new Date() }]
      },
    },
  }
})

const { withSweepLock } = await import('../sweep-lock')
const { withWorkspace } = await import('./workspace-scope')
const { getWorkspaceScope } = await import('@/lib/server/workspaces/workspace-context')
const { runWithoutLogContext } = await import('@/lib/server/log-context')

/**
 * Which workspaces' databases the lock touched, deduped.
 *
 * `withSweepLock` issues two statements per acquisition (the claim and the
 * release), so the raw list double-counts. The claim under test is *whose*
 * database was written, not how many statements it took.
 */
function workspacesTouched(): (string | null)[] {
  return [...new Set(hoisted.locksTakenInScope)]
}

/** Arm a timer the way `bootstrap.ts` does, and resolve when it has run. */
function armTimer(body: () => void | Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => void Promise.resolve(body()).then(() => resolve()), 0)
  })
}

beforeEach(() => {
  hoisted.fleetPasses = 0
  hoisted.locksTakenInScope.length = 0
  hoisted.pooled = true
})

describe('a timer armed inside a request', () => {
  it('CONTROL: inherits the arming request’s workspace scope', async () => {
    // The precondition for everything below. If AsyncLocalStorage did not
    // propagate into the timer, the fix would be pinning nothing.
    let seen: string | null | undefined
    await withWorkspace('workspace-alpha', () =>
      armTimer(() => {
        seen = getWorkspaceScope()?.workspace.workspaceKey ?? null
      })
    )

    expect(seen).toBe('workspace-alpha')
  })

  it('CONTROL: so the sweep never fans out, and claims one workspace’s database', async () => {
    await withWorkspace('workspace-alpha', () =>
      armTimer(() => withSweepLock('telemetry_ping', 1000, async () => {}))
    )

    expect(hoisted.fleetPasses).toBe(0)
    expect(workspacesTouched()).toEqual(['workspace-alpha'])
  })

  it('detached with runWithoutLogContext, it fans out across the fleet instead', async () => {
    await withWorkspace('workspace-alpha', () =>
      armTimer(() =>
        runWithoutLogContext(() => withSweepLock('telemetry_ping', 1000, async () => {}))
      )
    )

    expect(hoisted.fleetPasses).toBe(1)
  })

  it('detaches whichever workspace armed it — not just the first one', async () => {
    await withWorkspace('workspace-bravo', () =>
      armTimer(() =>
        runWithoutLogContext(() => withSweepLock('telemetry_ping', 1000, async () => {}))
      )
    )

    expect(hoisted.fleetPasses).toBe(1)
  })

  it('survives the nesting a real timer chain has: timer arms an interval', async () => {
    // `startTelemetry` arms a `setInterval` from inside the detached timer, and
    // every later tick inherits whatever context that call had. Detaching once
    // at the outer boundary has to cover the whole chain.
    let innerScope: string | null | undefined
    await withWorkspace('workspace-alpha', () =>
      armTimer(() =>
        runWithoutLogContext(
          () =>
            new Promise<void>((resolve) => {
              const handle = setInterval(() => {
                innerScope = getWorkspaceScope()?.workspace.workspaceKey ?? null
                clearInterval(handle)
                resolve()
              }, 0)
            })
        )
      )
    )

    expect(innerScope).toBeNull()
  })
})

describe('single-workspace behaviour is untouched', () => {
  it('takes the lock directly, with no fleet pass, exactly as before', async () => {
    hoisted.pooled = false

    await armTimer(() =>
      runWithoutLogContext(() => withSweepLock('telemetry_ping', 1000, async () => {}))
    )

    expect(hoisted.fleetPasses).toBe(0)
    expect(workspacesTouched()).toEqual([null])
  })
})

describe('the production call site, not just the mechanism', () => {
  // The round-2 version of this file tested `runWithoutLogContext` in isolation
  // and the ledger claimed bootstrap.ts was "pinned by" it. It was not:
  // reverting the wrapper at bootstrap.ts — its only production caller
  // repo-wide — left this suite 6/6 green, because nothing here imported the
  // module it claimed to pin. Asserting on the mechanism and naming a call site
  // is the eighteenth could-not-have-failed shape in this run.
  //
  // Read the source and assert the shape, the way `policy/` scanners do. A
  // behavioural test would have to stand up `createServerOnlyFn` plus five
  // dynamic imports to reach ten lines; this reaches them exactly.
  const source = readFileSync(join(__dirname, '../functions/bootstrap.ts'), 'utf8')
  const sf = ts.createSourceFile('bootstrap.ts', source, ts.ScriptTarget.Latest, false)

  /** The `setTimeout(...)` call that arms telemetry, as an AST node. */
  function telemetryTimer(): ts.CallExpression | null {
    let found: ts.CallExpression | null = null
    const visit = (node: ts.Node): void => {
      if (found) return
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'setTimeout' &&
        node.getText(sf).includes('startTelemetry')
      ) {
        found = node
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    return found
  }

  it('finds the telemetry timer at all', () => {
    // If bootstrap.ts stops arming telemetry this way, the two assertions below
    // would pass vacuously. This is what stops that.
    expect(telemetryTimer()).not.toBeNull()
  })

  it('arms it through runWithoutLogContext', () => {
    expect(telemetryTimer()!.getText(sf)).toContain('runWithoutLogContext')
  })

  it('gates it behind shouldRunWorkers, so a role=web replica stays silent', () => {
    // §1's scale-to-zero argument is that "a QUACKBACK_ROLE=web replica runs
    // none of them". Detaching the scope made the sweep fleet-wide, which is
    // right in direction but would have had every web replica walking every
    // workspace hourly — a wider blast radius than the bug it fixed.
    let guarded = false
    const visit = (node: ts.Node): void => {
      if (
        ts.isIfStatement(node) &&
        node.expression.getText(sf).includes('shouldRunWorkers()') &&
        node.expression.getText(sf).includes('_initialized') &&
        node.thenStatement.getText(sf).includes('startTelemetry')
      ) {
        guarded = true
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    expect(guarded).toBe(true)
  })
})
