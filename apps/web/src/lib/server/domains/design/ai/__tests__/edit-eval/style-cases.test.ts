/**
 * The styling cases hold their own answers: each case's operations and
 * styles, applied as the loop applies a step, make a design its rule calls
 * right with nothing stray, and the design as it was is never right.
 */
import { describe, expect, it } from 'vitest'
import { homeBlockTypes } from '@/lib/shared/design/home'
import { applyStep } from '@/lib/shared/design/agent/style-ops'
import { STYLE_REGISTRY } from '@/lib/shared/design/agent/style-registry'
import { GATES, PLACES, fixtureDesign } from './cases'
import { STYLE_CASES, judgeStyle } from './style-cases'

const world = {
  gates: GATES,
  places: PLACES,
  untrusted: { blockTypes: homeBlockTypes(GATES), links: new Set<string>(), checkCss: () => null },
}

describe('the styling eval set', () => {
  it('has at least fifteen cases', () => {
    expect(STYLE_CASES.length).toBeGreaterThanOrEqual(15)
  })

  for (const c of STYLE_CASES) {
    it(`answers “${c.request}” with its operations and styles`, () => {
      const before = fixtureDesign()
      const out = applyStep(
        before,
        world,
        STYLE_REGISTRY,
        c.ops,
        c.styles,
        c.picked ?? { scope: 'site' }
      )
      expect(out.refused, c.name).toEqual([])
      expect(out.outOfScope, c.name).toEqual([])
      expect(judgeStyle(c, before, out.design), c.name).toEqual({ right: true, stray: [] })
    })

    it(`is not answered by the design as it was: “${c.name}”`, () => {
      expect(judgeStyle(c, fixtureDesign(), fixtureDesign()).right).toBe(false)
    })
  }
})
