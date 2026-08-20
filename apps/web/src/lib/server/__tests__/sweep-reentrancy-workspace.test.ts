/**
 * The in-process sweep reentrancy guard, across workspaces.
 *
 * §4.2 lists `merge-check.service.ts:115` and `summary.service.ts:206`
 * `_sweepInProgress` as a site where "workspace A's sweep silently drops workspace
 * B's". Silently is the operative word: the sweep returns, nothing is logged,
 * nothing errors, and the only symptom is that some workspaces' summaries and
 * merge suggestions stop refreshing.
 *
 * The overlap is ordinary rather than exotic. `startup.ts` fires each sweep at
 * boot and again every 30 minutes; a fleet pass is serial over every workspace;
 * and the summary sweep processes batches of 50 with a 500 ms pause between
 * them and an AI call per post. A pass that takes longer than the interval
 * means two passes are in flight, and with one boolean the second pass is
 * suppressed for every workspace by whichever workspace the first pass is still on.
 *
 * ## Reaching the branch
 *
 * Each case holds the first workspace's sweep OPEN on an unresolved promise while
 * the second workspace's sweep is called. Without that the latch is already false
 * by the time the second call arrives and the assertions would hold with the
 * fix reverted — a fixture that never reaches the branch it asserts about.
 * `it('...the guard is actually engaged')` pins exactly that precondition.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  withWorkspaceSweepReentrancyGuard,
  __resetSweepReentrancyForWorkspace,
} from '../sweep-lock'
import { withWorkspace } from './workspace-scope'

/** A promise plus the handle to settle it, so a sweep can be held mid-flight. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

beforeEach(() => {
  for (const id of ['workspace-alpha', 'workspace-bravo']) {
    withWorkspace(id, () => __resetSweepReentrancyForWorkspace())
  }
  __resetSweepReentrancyForWorkspace()
})

describe('a sweep in flight for one workspace', () => {
  it('does not suppress another workspace’s sweep', async () => {
    const held = deferred()
    const ran: string[] = []

    const alpha = withWorkspace('workspace-alpha', () =>
      withWorkspaceSweepReentrancyGuard('summary_sweep', async () => {
        ran.push('alpha')
        await held.promise
      })
    )
    // alpha is now inside the guard and has not returned.
    await Promise.resolve()

    await withWorkspace('workspace-bravo', () =>
      withWorkspaceSweepReentrancyGuard('summary_sweep', async () => {
        ran.push('bravo')
      })
    )

    expect(ran).toEqual(['alpha', 'bravo'])
    held.resolve()
    await alpha
  })

  it('suppresses the SAME workspace’s second sweep — the guard is actually engaged', async () => {
    // The control that makes the case above mean something. If this passed
    // too, the guard would simply not be doing anything and the isolation
    // assertion would be vacuous.
    const held = deferred()
    const ran: string[] = []

    const first = withWorkspace('workspace-alpha', () =>
      withWorkspaceSweepReentrancyGuard('summary_sweep', async () => {
        ran.push('first')
        await held.promise
      })
    )
    await Promise.resolve()

    await withWorkspace('workspace-alpha', () =>
      withWorkspaceSweepReentrancyGuard('summary_sweep', async () => {
        ran.push('second')
      })
    )

    expect(ran).toEqual(['first'])
    held.resolve()
    await first
  })

  it('does not suppress in the other order either', async () => {
    const held = deferred()
    const ran: string[] = []

    const bravo = withWorkspace('workspace-bravo', () =>
      withWorkspaceSweepReentrancyGuard('merge_sweep', async () => {
        ran.push('bravo')
        await held.promise
      })
    )
    await Promise.resolve()

    await withWorkspace('workspace-alpha', () =>
      withWorkspaceSweepReentrancyGuard('merge_sweep', async () => {
        ran.push('alpha')
      })
    )

    expect(ran).toEqual(['bravo', 'alpha'])
    held.resolve()
    await bravo
  })

  it('keeps two different sweeps on one workspace independent', async () => {
    const held = deferred()
    const ran: string[] = []

    const summary = withWorkspace('workspace-alpha', () =>
      withWorkspaceSweepReentrancyGuard('summary_sweep', async () => {
        ran.push('summary')
        await held.promise
      })
    )
    await Promise.resolve()

    await withWorkspace('workspace-alpha', () =>
      withWorkspaceSweepReentrancyGuard('merge_sweep', async () => {
        ran.push('merge')
      })
    )

    expect(ran).toEqual(['summary', 'merge'])
    held.resolve()
    await summary
  })

  it('releases the latch when the sweep throws', async () => {
    const ran: string[] = []
    await expect(
      withWorkspace('workspace-alpha', () =>
        withWorkspaceSweepReentrancyGuard('summary_sweep', async () => {
          ran.push('first')
          throw new Error('boom')
        })
      )
    ).rejects.toThrow('boom')

    await withWorkspace('workspace-alpha', () =>
      withWorkspaceSweepReentrancyGuard('summary_sweep', async () => {
        ran.push('second')
      })
    )

    expect(ran).toEqual(['first', 'second'])
  })
})
