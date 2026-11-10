/**
 * The eval set holds its own answers: every case's operations, applied as
 * Ask AI applies the model's, make a design its rule calls right, so a
 * wrong score in the live eval is the model's and never the set's.
 */
import { describe, expect, it } from 'vitest'
import { applyOps } from '@/lib/shared/design/design-ops'
import { homeBlockTypes } from '@/lib/shared/design/home'
import { EVAL_CASES, GATES, HELD_OUT_CASES, MARK_CASES, PLACES, caseDesign, judge } from './cases'
import { OVERRIDE_CASES } from './override-cases'

const world = {
  gates: GATES,
  places: PLACES,
  untrusted: {
    blockTypes: homeBlockTypes(GATES),
    links: new Set(['https://docs.acme.dev', 'https://docs.acme.com']),
    checkCss: () => 'no CSS',
  },
}

describe('the edit eval set', () => {
  it('has twenty to thirty-five cases', () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(20)
    expect(EVAL_CASES.length).toBeLessThanOrEqual(35)
  })

  it('leaves the design as it was when nothing is asked', () => {
    for (const c of [...EVAL_CASES, ...HELD_OUT_CASES, ...MARK_CASES, ...OVERRIDE_CASES])
      expect(judge(c, caseDesign(c), caseDesign(c)).right, c.name).toBe(false)
  })

  for (const c of [...EVAL_CASES, ...HELD_OUT_CASES, ...MARK_CASES, ...OVERRIDE_CASES])
    it(`answers “${c.request}” with its operations`, () => {
      const before = caseDesign(c)
      const result = applyOps(before, world, c.ops, c.picked ?? { scope: 'site' })
      expect(result.refused, c.name).toEqual([])
      expect(result.outOfScope, c.name).toEqual([])
      expect(judge(c, before, result.design), c.name).toEqual({ right: true, stray: [] })
    })
})
