/**
 * The cascade of element looks as CSS: each layer in its own ordered
 * sub-layer of the design layer (the rest of the design, everywhere, a page,
 * a block, a part), phones' values under the phone breakpoint in the same
 * layer, and text on an override's fill moved until it reads.
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../contrast'
import { renderDesignCss, resolveDesign } from '../resolve'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'
import { DESIGN_LAYERS, PHONE_MEDIA } from '../style-css'

const design = (change: (d: PortalDesign) => void) => {
  const d = defaultDesign()
  change(d)
  return portalDesign.parse(d)
}
const cssOf = (d: PortalDesign) => renderDesignCss(resolveDesign(d))

/** The bodies of every `@layer <name> { ... }` block, braces balanced, joined. */
function layerBody(css: string, name: string): string {
  const bodies: string[] = []
  let from = 0
  for (;;) {
    const start = css.indexOf(`@layer ${name} {`, from)
    if (start < 0) return bodies.join(' ')
    const open = css.indexOf('{', start)
    let depth = 0
    let i = open
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) break
    }
    bodies.push(css.slice(open + 1, i))
    from = i
  }
}

const withAll = () =>
  design((d) => {
    d.pages.home.blocks = [
      {
        type: 'ideas',
        id: 'abcdefgh',
        sort: 'top',
        count: 3,
        grid: { x: 0, y: 0, w: 6, h: 2 },
        look: { style: { link: { base: { weight: 600 } } } },
      },
    ]
    d.style = { button: { base: { radius: 2 } } }
    d.overrides = [
      {
        id: '',
        target: { scope: 'page', page: 'feedback', element: 'button' },
        style: { base: { radius: 6 } },
      },
      {
        id: '',
        target: { scope: 'part', part: 'hero.home.cta', element: 'button' },
        style: { base: { radius: 12 } },
      },
    ]
  })

describe('the layers', () => {
  it('declares the design’s sub-layers in cascade order, before any of its rules', () => {
    expect(DESIGN_LAYERS).toEqual([
      'design.base',
      'design.style',
      'design.page',
      'design.block',
      'design.part',
    ])
    const css = cssOf(withAll())
    const order = `@layer ${DESIGN_LAYERS.join(', ')};`
    expect(css).toContain(order)
    expect(css.indexOf(order)).toBeLessThan(css.search(/@layer design\.\w+ \{/))
    // Never before another layer, whose order a style tag ahead of the app's stylesheet would change.
    expect(css.indexOf(order)).toBeGreaterThan(css.indexOf('@layer base {'))
  })

  it('keeps the rest of the design in the lowest sub-layer, none of it beside the sub-layers', () => {
    const css = cssOf(withAll())
    expect(css).not.toMatch(/@layer design \{/)
    expect(layerBody(css, 'design.base')).toContain('[data-qb-cards=raised]')
  })

  it('puts everywhere, a page, a block and a part each in its own sub-layer', () => {
    const css = cssOf(withAll())
    expect(layerBody(css, 'design.style')).toMatch(/--qb-st-button-base-radius/)
    const page = layerBody(css, 'design.page')
    expect(page).toContain(
      '[data-qb-page=feedback] :is([data-slot=button][data-variant=default], [data-qb-action])'
    )
    expect(layerBody(css, 'design.block')).toContain(
      '[data-qb-section="block-abcdefgh"] :is(.prose a, [data-qb-link])'
    )
    const part = layerBody(css, 'design.part')
    expect(part).toContain('[data-qb-page=home] [data-qb-section=hero] [data-qb-action]:is(')
    // Each reads its own value.
    const tokens = resolveDesign(withAll()).tokens.light
    expect(
      Object.entries(tokens)
        .filter(([k]) => k.endsWith('button-base-radius'))
        .map(([, v]) => v)
        .sort()
    ).toEqual(['12px', '2px', '6px'])
  })

  it('draws nothing for an orphaned part', () => {
    const css = cssOf(
      design((d) => {
        d.overrides = [
          {
            id: '',
            target: { scope: 'part', part: 'block.zzzzzzzz.heading', element: 'heading' },
            style: { base: { size: 20 } },
          },
        ]
      })
    )
    expect(layerBody(css, 'design.part')).toBe('')
  })
})

describe('phones', () => {
  it('draws phone values under the phone breakpoint, in the layer of their scope', () => {
    const css = cssOf(
      design((d) => {
        d.stylePhone = { headline: { base: { size: 28 } } }
        d.overrides = [
          {
            id: '',
            target: { scope: 'part', part: 'hero.home.cta', element: 'button' },
            phone: { base: { height: 48 } },
          },
          {
            id: '',
            target: { scope: 'page', page: 'roadmap', element: 'card' },
            phone: { base: { paddingX: 8 } },
          },
        ]
        d.pages.home.blocks = [
          {
            type: 'ideas',
            id: 'abcdefgh',
            sort: 'top',
            count: 3,
            grid: { x: 0, y: 0, w: 6, h: 2 },
            look: { phone: { heading: { base: { size: 14 } } } },
          },
        ]
      })
    )
    expect(PHONE_MEDIA).toBe('(max-width: 39.99rem)')
    // The page's style tag escapes `<`, which would break the query.
    expect(PHONE_MEDIA).not.toMatch(/[<>]/)
    const media = `@media ${PHONE_MEDIA}`
    for (const [layer, decl] of [
      ['design.style', 'font-size: 28px'],
      ['design.part', 'min-height: 48px'],
      ['design.page', 'padding-inline: 8px'],
      ['design.block', 'font-size: 14px'],
    ] as const) {
      const body = layerBody(css, layer)
      expect(body, layer).toContain(media)
      expect(body.slice(body.indexOf(media)), layer).toContain(decl)
      expect(body.slice(0, body.indexOf(media)), layer).not.toContain(decl)
    }
  })
})

describe('readability', () => {
  it('moves the text on a part’s own fill until it reads, and reports the check against the part', () => {
    const d = design((d) => {
      d.overrides = [
        {
          id: '',
          target: { scope: 'part', part: 'hero.home.cta', element: 'button' },
          style: { base: { background: '#1e1b4b', color: '#222244' } },
        },
      ]
    })
    const resolved = resolveDesign(d)
    const text = Object.entries(resolved.tokens.light).find(([k]) =>
      /^--qb-st-p\d+-button-base-color$/.test(k)
    )?.[1]
    expect(text).toBeTruthy()
    expect(contrastRatio(text!, '#1e1b4b')).toBeGreaterThanOrEqual(4.5)
    expect(resolved.styled.some((c) => c.where.startsWith('part hero.home.cta'))).toBe(true)
  })

  it('reads a page override’s text on the fill set everywhere below it', () => {
    const d = design((d) => {
      d.style = { button: { base: { background: '#111111' } } }
      d.overrides = [
        {
          id: '',
          target: { scope: 'page', page: 'feedback', element: 'button' },
          style: { base: { color: '#222222' } },
        },
      ]
    })
    const resolved = resolveDesign(d)
    const text = Object.entries(resolved.tokens.light).find(([k]) =>
      /^--qb-st-g\d+-button-base-color$/.test(k)
    )?.[1]
    expect(contrastRatio(text!, '#111111')).toBeGreaterThanOrEqual(4.5)
  })
})
