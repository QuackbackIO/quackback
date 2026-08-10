/**
 * The SSE concurrency gauge, across workspaces.
 *
 * §4.2 records this as the site where "one workspace starves the pod". Two things
 * are true and they want opposite treatments, which is the whole reason this
 * needed a decision rather than a `WorkspaceKeyedCache`:
 *
 * - The **global** cap describes the process. File descriptors are not
 *   partitioned by workspace, so it stays shared deliberately.
 * - The **per-IP** cap describes a client of a workspace, and sharing it is a
 *   real cross-workspace effect with no upside: a NAT'd office using two Quackback
 *   workspaces has the second one's streams refused because of the first's.
 *
 * So a per-workspace cap is added below the global one, and the per-IP counter is
 * moved inside the workspace. `workspaceOf` is injected here rather than read from
 * the ambient scope so a case can drive both workspaces without opening real
 * scopes around every acquire — the production singleton uses the ambient
 * namespace, which `it('defaults to the ambient workspace scope')` pins.
 */
import { describe, it, expect } from 'vitest'
import { createStreamLimiter } from '../stream-connection-limit'
import { withWorkspace } from '@/lib/server/__tests__/workspace-scope'

/** A limiter whose workspace is settable between acquires. */
function switchable(opts: Parameters<typeof createStreamLimiter>[0] = {}) {
  let workspace = 'alpha'
  const lim = createStreamLimiter({ ...opts, workspaceOf: () => workspace })
  return { lim, as: (t: string) => void (workspace = t) }
}

describe('per-workspace fairness', () => {
  it('one workspace exhausting its share leaves another able to open a stream', () => {
    const { lim, as } = switchable({ maxGlobal: 100, maxPerWorkspace: 3, maxPerIp: 100 })

    as('alpha')
    const alphaSlots = [lim.acquire('1.1.1.1'), lim.acquire('1.1.1.2'), lim.acquire('1.1.1.3')]
    expect(alphaSlots.every((s) => s.ok)).toBe(true)
    // The precondition the next assertion depends on: alpha is genuinely at
    // its cap, so a fourth alpha stream is refused.
    expect(lim.acquire('1.1.1.4').ok).toBe(false)

    as('bravo')
    expect(lim.acquire('1.1.1.5').ok).toBe(true)
  })

  it('holds in the other order too', () => {
    const { lim, as } = switchable({ maxGlobal: 100, maxPerWorkspace: 2, maxPerIp: 100 })

    as('bravo')
    expect(lim.acquire('2.2.2.1').ok).toBe(true)
    expect(lim.acquire('2.2.2.2').ok).toBe(true)
    expect(lim.acquire('2.2.2.3').ok).toBe(false)

    as('alpha')
    expect(lim.acquire('2.2.2.4').ok).toBe(true)
  })

  it('releasing returns the slot to the workspace it was taken from', () => {
    // An SSE stream outlives the request scope that opened it, so `release`
    // captures the workspace rather than re-reading it. Without that a stream
    // closed under another scope would decrement the wrong workspace's count
    // and leave the opening workspace permanently short.
    const { lim, as } = switchable({ maxGlobal: 100, maxPerWorkspace: 1, maxPerIp: 100 })

    as('alpha')
    const slot = lim.acquire('3.3.3.1')
    expect(slot.ok).toBe(true)
    as('bravo')
    slot.release()

    expect(lim.workspaceOpenCount('alpha')).toBe(0)
    expect(lim.workspaceOpenCount('bravo')).toBe(0)
    as('alpha')
    expect(lim.acquire('3.3.3.2').ok).toBe(true)
  })

  it('a double release does not credit the workspace twice', () => {
    const { lim, as } = switchable({ maxGlobal: 100, maxPerWorkspace: 2, maxPerIp: 100 })
    as('alpha')
    const slot = lim.acquire('4.4.4.1')
    slot.release()
    slot.release()

    expect(lim.workspaceOpenCount('alpha')).toBe(0)
    expect(lim.openCount).toBe(0)
  })
})

describe('per-IP counting is inside the workspace', () => {
  it('one office IP hitting its limit in one workspace can still stream in another', () => {
    const { lim, as } = switchable({ maxGlobal: 100, maxPerWorkspace: 100, maxPerIp: 2 })
    const OFFICE = '198.51.100.9'

    as('alpha')
    expect(lim.acquire(OFFICE).ok).toBe(true)
    expect(lim.acquire(OFFICE).ok).toBe(true)
    expect(lim.acquire(OFFICE).ok).toBe(false)

    as('bravo')
    expect(lim.acquire(OFFICE).ok).toBe(true)
  })

  it('still enforces the per-IP cap within one workspace', () => {
    // The control: if the per-IP dimension had simply stopped working, the case
    // above would pass for the wrong reason.
    const { lim, as } = switchable({ maxGlobal: 100, maxPerWorkspace: 100, maxPerIp: 1 })
    as('alpha')
    expect(lim.acquire('203.0.113.1').ok).toBe(true)
    expect(lim.acquire('203.0.113.1').ok).toBe(false)
    expect(lim.acquire('203.0.113.2').ok).toBe(true)
  })

  it('counts (workspace, IP) pairs so the bucket map does not leak', () => {
    const { lim, as } = switchable({ maxGlobal: 100, maxPerWorkspace: 100, maxPerIp: 5 })
    as('alpha')
    const a = lim.acquire('203.0.113.1')
    as('bravo')
    const b = lim.acquire('203.0.113.1')

    expect(lim.ipCount).toBe(2)
    a.release()
    b.release()
    expect(lim.ipCount).toBe(0)
    expect(lim.workspaceCount).toBe(0)
  })
})

describe('the global cap stays global on purpose', () => {
  it('binds across workspaces, because file descriptors are a property of the process', () => {
    const { lim, as } = switchable({ maxGlobal: 2, maxPerWorkspace: 100, maxPerIp: 100 })
    as('alpha')
    expect(lim.acquire('5.5.5.1').ok).toBe(true)
    as('bravo')
    expect(lim.acquire('5.5.5.2').ok).toBe(true)
    as('charlie')
    expect(lim.acquire('5.5.5.3').ok).toBe(false)
  })
})

describe('single-workspace behaviour is unchanged', () => {
  it('defaults to the ambient workspace scope, and to one bucket when there is none', () => {
    const lim = createStreamLimiter({ maxGlobal: 10, maxPerWorkspace: 1, maxPerIp: 10 })

    // No scope: everything lands in the single-workspace namespace, so the
    // per-workspace cap behaves exactly like a second global cap and a
    // self-hosted install sees no new refusal it would not have seen before.
    expect(lim.acquire('6.6.6.1').ok).toBe(true)
    expect(lim.acquire('6.6.6.2').ok).toBe(false)

    // …and a real scope moves the bucket.
    withWorkspace('workspace-alpha', () => {
      expect(lim.acquire('6.6.6.3').ok).toBe(true)
    })
  })
})
