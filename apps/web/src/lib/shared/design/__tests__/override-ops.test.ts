/**
 * Quackback AI's override operation: an element's look set for one part
 * ("just this button"), one page ("only on the roadmap page"), one Home
 * block, or everywhere, on all screens, on phones or in dark mode, each
 * checked as the builder checks a person's change and refused in plain words.
 */
import { describe, expect, it } from 'vitest'
import { applyOp, applyOps, type FlatOp, type OpWorld } from '../design-ops'
import { homeBlockTypes } from '../home'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'
import { findOverride } from '../style-overrides'
import { overridesNow, partsText } from '../override-ops'

const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}
const model: OpWorld = {
  gates: GATES,
  places: { boards: [], roadmaps: [], categories: [] },
  untrusted: { blockTypes: homeBlockTypes(GATES), links: new Set(), checkCss: () => 'no CSS' },
}

function design(): PortalDesign {
  const d = defaultDesign()
  d.nav.home = { on: true, tab: true }
  d.pages.home.blocks = [
    { id: 'contact001', type: 'contact', grid: { x: 0, y: 0, w: 6, h: 1 } },
    { id: 'updates001', type: 'updates', count: 3, grid: { x: 6, y: 0, w: 6, h: 1 } },
  ] as PortalDesign['pages']['home']['blocks']
  return portalDesign.parse(d)
}

const op = (target: string, key: string, value: string): FlatOp => ({
  op: 'override',
  target,
  key,
  value,
})

const ok = (result: ReturnType<typeof applyOp>) => {
  if (!result.ok) throw new Error(result.refusal)
  return result
}

describe('the override operation', () => {
  it('sets one part’s look: just the hero’s call to action', () => {
    const result = ok(
      applyOp(design(), model, op('part:hero.home.cta', 'button.base.background', 'ink'))
    )
    expect(findOverride(result.design, 'part:hero.home.cta:button')?.style).toEqual({
      base: { background: 'ink' },
    })
    expect(result.design.style).toBeUndefined()
    expect(result.label).toMatch(/Call to action/)
  })

  it('takes the part’s own element when the key leaves it out', () => {
    const result = ok(
      applyOp(design(), model, op('part:hero.home.cta', 'hover.background', '#000'))
    )
    expect(findOverride(result.design, 'part:hero.home.cta:button')?.style).toEqual({
      hover: { background: '#000000' },
    })
  })

  it('takes a part by its bare name', () => {
    const result = ok(applyOp(design(), model, op('hero.home.headline', 'size', '40')))
    expect(findOverride(result.design, 'part:hero.home.headline:headline')?.style).toEqual({
      base: { size: 40 },
    })
  })

  it('sets one page’s look: buttons only on the roadmap page', () => {
    const result = ok(applyOp(design(), model, op('page:roadmap', 'button.radius', '999')))
    expect(findOverride(result.design, 'page:roadmap:button')?.style).toEqual({
      base: { radius: 999 },
    })
  })

  it('reads a page as people name it', () => {
    for (const target of ['roadmap page', 'the Roadmap page', 'page:Roadmap']) {
      const result = ok(applyOp(design(), model, op(target, 'card.shadow', 'lifted')))
      expect(findOverride(result.design, 'page:roadmap:card'), target).toBeDefined()
    }
    const help = ok(applyOp(design(), model, op('help center', 'link.color', 'support')))
    expect(findOverride(help.design, 'page:help:link')).toBeDefined()
  })

  it('sets phones’ own sizes, at every scope', () => {
    const part = ok(applyOp(design(), model, op('part:hero.home.headline', 'phone.size', '32')))
    expect(findOverride(part.design, 'part:hero.home.headline:headline')?.phone).toEqual({
      base: { size: 32 },
    })
    const everywhere = ok(applyOp(design(), model, op('everywhere', 'phone.button.height', '48')))
    expect(everywhere.design.stylePhone).toEqual({ button: { base: { height: 48 } } })
    expect(everywhere.label).toMatch(/phones/)
    const block = ok(applyOp(design(), model, op('block:updates001', 'phone.heading.size', '18')))
    expect(block.design.pages.home.blocks.find((b) => b.id === 'updates001')?.look?.phone).toEqual({
      heading: { base: { size: 18 } },
    })
  })

  it('refuses a colour on phones, which the mode decides on every screen', () => {
    const result = applyOp(design(), model, op('page:roadmap', 'phone.button.background', '#000'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.refusal).toMatch(/phone/i)
  })

  it('sets dark mode’s own colour for a part or a page', () => {
    const result = ok(applyOp(design(), model, op('page:changelog', 'dark.link.color', '#93c5fd')))
    expect(findOverride(result.design, 'page:changelog:link')?.styleDark).toEqual({
      base: { color: '#93c5fd' },
    })
  })

  it('sets a Home block’s own look, as op set does', () => {
    const result = ok(applyOp(design(), model, op('block:contact001', 'heading.color', 'support')))
    expect(result.design.pages.home.blocks.find((b) => b.id === 'contact001')?.look?.style).toEqual(
      { heading: { base: { color: 'support' } } }
    )
  })

  it('sets the look everywhere, as op theme does', () => {
    const result = ok(applyOp(design(), model, op('everywhere', 'button.hover.lift', '2')))
    expect(result.design.style).toEqual({ button: { hover: { lift: 2 } } })
  })

  it('clears a value with null, and the override with it', () => {
    const set = ok(applyOp(design(), model, op('part:hero.home.cta', 'background', 'ink')))
    const cleared = ok(applyOp(set.design, model, op('part:hero.home.cta', 'background', 'null')))
    expect(cleared.design.overrides).toBeUndefined()
  })

  it('takes the override paths the builder writes, with op theme', () => {
    const result = ok(
      applyOp(design(), model, {
        op: 'theme',
        key: 'overrides.page:roadmap:button.style.hover.background',
        value: 'support',
      })
    )
    expect(findOverride(result.design, 'page:roadmap:button')?.style).toEqual({
      hover: { background: 'support' },
    })
    const phone = ok(
      applyOp(design(), model, { op: 'theme', key: 'stylePhone.headline.base.size', value: '30' })
    )
    expect(phone.design.stylePhone).toEqual({ headline: { base: { size: 30 } } })
  })

  it('refuses what is not there, in words that say what is', () => {
    const cases: Array<[FlatOp, RegExp]> = [
      [op('part:hero.home.nothing', 'color', 'ink'), /no part called/],
      [op('part:block.gone0001.heading', 'color', 'ink'), /no part called/],
      [op('part:hero.home.cta', 'heading.color', 'ink'), /Call to action · Hero is a button/],
      [op('part:header.login', 'color', 'ink'), /name one: button, ghost or secondary/],
      [op('page:nowhere', 'button.color', 'ink'), /page/],
      [op('page:roadmap', 'color', 'ink'), /element/],
      [op('page:roadmap', 'button.shimmer', '1'), /button.*shimmer|shimmer/],
      [op('block:contact001', 'dark.heading.color', '#fff'), /dark/],
      [op('block:contact001', 'navItem.color', 'ink'), /block/],
      [op('page:roadmap', 'button.base.radius', '5000'), /.+/],
    ]
    for (const [each, why] of cases) {
      const result = applyOp(design(), model, each)
      expect(result.ok, JSON.stringify(each)).toBe(false)
      if (!result.ok) expect(result.refusal, JSON.stringify(each)).toMatch(why)
    }
  })

  it('stays within what was picked', () => {
    const d = design()
    const hero = applyOps(
      d,
      model,
      [op('part:hero.home.cta', 'background', 'ink'), op('page:roadmap', 'button.radius', '4')],
      { scope: 'band' }
    )
    expect(hero.done.map((each) => each.op.target)).toEqual(['part:hero.home.cta'])
    expect(hero.outOfScope.map((each) => each.target)).toEqual(['page:roadmap'])
    const block = applyOps(
      d,
      model,
      [
        op('part:block.contact001.button', 'background', 'ink'),
        op('block:contact001', 'heading.color', 'support'),
        op('part:block.updates001.heading', 'color', 'support'),
      ],
      { scope: 'home', blockId: 'contact001' }
    )
    expect(block.done).toHaveLength(2)
    expect(block.outOfScope.map((each) => each.target)).toEqual(['part:block.updates001.heading'])
    const roadmap = applyOps(d, model, [op('page:roadmap', 'card.shadow', 'soft')], {
      scope: 'roadmap',
    })
    expect(roadmap.done).toHaveLength(1)
    const buttons = applyOps(
      d,
      model,
      [op('page:roadmap', 'button.radius', '4'), op('page:roadmap', 'card.radius', '4')],
      { scope: 'button' }
    )
    expect(buttons.done).toHaveLength(1)
  })
})

describe('what Quackback AI is told of overrides', () => {
  it('lists the parts a design has, by name and element', () => {
    const text = partsText(design())
    expect(text).toContain('hero.home.cta (Call to action, button)')
    expect(text).toContain('block.contact001.button')
    expect(text).toContain('header.login')
  })

  it('says what is set now, as override paths', () => {
    const d = ok(applyOp(design(), model, op('part:hero.home.cta', 'background', 'ink'))).design
    expect(overridesNow(d)).toContain('part:hero.home.cta:button style.base.background="ink"')
    expect(overridesNow(design())).toBe('none')
  })
})

describe('phones’ own values with op set on a Home block', () => {
  it('are the block’s own phone look', () => {
    const result = ok(
      applyOp(design(), model, {
        op: 'set',
        target: 'updates001',
        key: 'phone.heading.size',
        value: '18',
      })
    )
    expect(result.design.pages.home.blocks.find((b) => b.id === 'updates001')?.look?.phone).toEqual(
      { heading: { base: { size: 18 } } }
    )
  })
})

describe('the parts Quackback AI is told of', () => {
  it('leave out the footer, the only one of its kind, styled everywhere with style.footer', () => {
    expect(partsText(design())).not.toMatch(/\bfooter \(/)
  })
})

describe('op set aimed at a part', () => {
  it('is the override it names, and stays within the picked block', () => {
    const result = applyOps(
      design(),
      model,
      [
        {
          op: 'set',
          target: 'block.updates001.heading',
          key: 'style.heading.base.color',
          value: 'accent',
        },
      ],
      { scope: 'home', blockId: 'updates001' }
    )
    expect(result.outOfScope).toEqual([])
    // A block's heading is what the block's own look styles in it, as "This block" reads it.
    expect(result.design.pages.home.blocks.find((b) => b.id === 'updates001')?.look?.style).toEqual(
      { heading: { base: { color: 'accent' } } }
    )
    expect(result.design.overrides).toBeUndefined()
  })
})

describe('headlines in lower case named as the case choice', () => {
  it('are the headline style, which has the step the choice lacks', () => {
    const result = ok(
      applyOp(design(), model, { op: 'theme', key: 'headlineCase', value: 'lower' })
    )
    expect(result.design.style).toEqual({ headline: { base: { case: 'lower' } } })
  })
})
