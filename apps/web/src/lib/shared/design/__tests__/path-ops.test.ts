/**
 * A field change, as the brand match writes one, read as the operation that
 * makes it: the same design either way, so the pipeline can move over a
 * change at a time.
 */
import { describe, expect, it } from 'vitest'
import { applyDesignChanges } from '../apply-changes'
import { applyOp } from '../design-ops'
import { pathChangeAsOp } from '../path-ops'
import { defaultDesign } from '../schema'

const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}
const world = { gates: GATES, places: { boards: [], roadmaps: [], categories: [] } }

describe('pathChangeAsOp', () => {
  const cases: Array<[string, unknown]> = [
    ['brand.light.accent', '#0f766e'],
    ['shape.corners', 'pill'],
    ['brand.fonts.headingWeight', 700],
    ['tune.headline.size', 60],
    ['layout.heroHeight', 'compact'],
    ['layout.heroAlign', 'centre'],
    ['pages.help.search', 'large'],
    ['pages.feedback.defaultSort', 'new'],
    ['pages.home.headline.title', 'Hello'],
    ['pages.titles.roadmap.subtitle', 'What is next'],
  ]

  for (const [path, value] of cases)
    it(`makes ${path} as its field change does`, () => {
      const op = pathChangeAsOp(path, value)
      expect(op).not.toBeNull()
      const byOp = applyOp(defaultDesign(), world, op!)
      const byPath = applyDesignChanges(defaultDesign(), [{ path, value }], 'site').design
      expect(byOp.ok && byOp.design).toEqual(byPath)
    })

  it('leaves Home’s layout, images and CSS as field changes', () => {
    expect(pathChangeAsOp('pages.home.blocks', [])).toBeNull()
    expect(pathChangeAsOp('brand.heroImage', { key: 'x' })).toBeNull()
    expect(pathChangeAsOp('css', 'a{}')).toBeNull()
  })
})
