import { describe, it, expect } from 'vitest'
import { diffTargets } from '../shadow-diff'
import type { HookTarget } from '../hook-types'

/** WO-15 — the shadow-diff core: multiset equality, divergence reporting, and
 *  the 'workflow'-sink exclusion (legacy never emitted workflow hook targets). */

const wh = (url: string): HookTarget => ({
  type: 'webhook',
  target: { url },
  config: { webhookId: 'w' },
})

describe('diffTargets (WO-15)', () => {
  it('reports equal for identical target sets (order-independent)', () => {
    const legacy = [wh('a'), wh('b')]
    const fresh = [wh('b'), wh('a')]
    expect(diffTargets(legacy, fresh).equal).toBe(true)
  })

  it('surfaces a target the legacy path produced but the new one missed', () => {
    const d = diffTargets([wh('a'), wh('b')], [wh('a')])
    expect(d.equal).toBe(false)
    expect(d.onlyLegacy.map((t) => (t.target as { url: string }).url)).toEqual(['b'])
    expect(d.onlyNew).toEqual([])
  })

  it('surfaces a spurious target the new path produced', () => {
    const d = diffTargets([wh('a')], [wh('a'), wh('c')])
    expect(d.equal).toBe(false)
    expect(d.onlyNew.map((t) => (t.target as { url: string }).url)).toEqual(['c'])
  })

  it('excludes workflow-sink targets from the comparison (expected extra)', () => {
    const legacy = [wh('a')]
    const fresh = [wh('a'), { type: 'workflow', target: {}, config: {} }]
    expect(diffTargets(legacy, fresh).equal).toBe(true)
  })

  it('treats config differences as divergence', () => {
    const legacy: HookTarget[] = [{ type: 'email', target: { email: 'x@y' }, config: { a: 1 } }]
    const fresh: HookTarget[] = [{ type: 'email', target: { email: 'x@y' }, config: { a: 2 } }]
    expect(diffTargets(legacy, fresh).equal).toBe(false)
  })

  it('handles empty on both sides (no subscribers) as equal', () => {
    expect(diffTargets([], []).equal).toBe(true)
  })
})
