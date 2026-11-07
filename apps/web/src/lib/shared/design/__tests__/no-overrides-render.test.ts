/**
 * A design with no overrides and no phone values draws exactly as it did
 * before element overrides: the same rules, and the same cascade. The
 * fixtures are bench designs with their words and files taken out, each with
 * the CSS the designer branch drew for it before overrides (`*.base.css`).
 *
 * The rules are compared with the design layer's sub-layers read as the one
 * layer they were; the cascade, by the order the CSS first names its layers
 * in, which must be the same as before (a page's style tag can come before
 * the app's stylesheet, and then first appearance sets the layers' order).
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderDesignCss, resolveDesign } from '../resolve'
import { portalDesign } from '../schema'
import { DESIGN_LAYERS } from '../style-css'

const FX = join(import.meta.dirname, 'fixtures', 'no-overrides')
const designs = readdirSync(FX)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''))

/** The CSS as one design layer: sub-layers read as `design`, layer statements left out. */
const asOneLayer = (css: string) =>
  css
    .replace(/@layer [\w.]+(, [\w.]+)+;\s*/g, '')
    .replace(/@layer design\.\w+ \{/g, '@layer design {')
    .replace(/\s+/g, ' ')
    .trim()

describe('a design with no overrides', () => {
  it('has fixtures', () => expect(designs.length).toBeGreaterThanOrEqual(4))

  it.each(designs)('%s draws the same rules as before', (name) => {
    const design = portalDesign.parse(JSON.parse(readFileSync(join(FX, `${name}.json`), 'utf8')))
    const now = renderDesignCss(resolveDesign(design))
    const before = readFileSync(join(FX, `${name}.base.css`), 'utf8')
    const [a, b] = [asOneLayer(now), asOneLayer(before)]
    let i = 0
    while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++
    // Where they part, for a readable failure.
    expect(a.slice(Math.max(0, i - 120), i + 120)).toBe(b.slice(Math.max(0, i - 120), i + 120))
    expect(a).toBe(b)
  })

  it.each(designs)(
    '%s names the layers in the same order as before, sub-layers stated first',
    (name) => {
      const design = portalDesign.parse(JSON.parse(readFileSync(join(FX, `${name}.json`), 'utf8')))
      const now = renderDesignCss(resolveDesign(design))
      const before = readFileSync(join(FX, `${name}.base.css`), 'utf8')
      // Where this style tag comes before the app's stylesheet, first appearance sets the order.
      expect(topLayers(now)).toEqual(topLayers(before))
      const statement = now.indexOf(`@layer ${DESIGN_LAYERS.join(', ')};`)
      expect(statement).toBeGreaterThan(-1)
      expect(statement).toBeLessThan(now.search(/@layer design\.\w+ \{/))
    }
  )
})

/** The top-level layers in the order the CSS first names them. */
function topLayers(css: string): string[] {
  const seen: string[] = []
  for (const [, names] of css.matchAll(/@layer ([\w., ]+?)\s*[;{]/g))
    for (const name of names!.split(',').map((n) => n.trim().split('.')[0]!))
      if (!seen.includes(name)) seen.push(name)
  return seen
}
