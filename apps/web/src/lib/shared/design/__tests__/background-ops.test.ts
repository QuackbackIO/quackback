import { describe, expect, it } from 'vitest'
import { applyOp, applyOps, type OpWorld } from '../design-ops'
import { homeBlockTypes } from '../home'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'

const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}
const WORLD: OpWorld = { gates: GATES, places: { boards: [], roadmaps: [], categories: [] } }
const MODEL: OpWorld = {
  ...WORLD,
  untrusted: { blockTypes: homeBlockTypes(GATES), links: new Set(), checkCss: () => 'no CSS' },
}
const IMAGE = 'portal-images/2026/11/0b9c-photo.webp'

function base(): PortalDesign {
  const doc = defaultDesign()
  doc.brand.light.accent = '#2563eb'
  return portalDesign.parse(doc)
}

const ok = (result: ReturnType<typeof applyOp>) => {
  if (!result.ok) throw new Error(result.refusal)
  return result
}

describe('the background operation', () => {
  it('sets every page’s background, labelled for its undo', () => {
    const result = ok(
      applyOp(base(), MODEL, {
        op: 'background',
        target: 'site',
        key: 'gradient',
        value: '{"stops":["brand colour","#ffffff"],"direction":"down"}',
      })
    )
    expect(result.label).toBe('Page background: Gradient')
    expect(result.design.layout.background).toEqual({
      kind: 'gradient',
      stops: ['accent', '#ffffff'],
      direction: 'down',
    })
  })

  it('sets one page’s own, which goes before the site’s, and a reset gives it back to the site', () => {
    const own = ok(
      applyOp(base(), MODEL, {
        op: 'background',
        target: 'roadmap page',
        key: 'pattern',
        value: '{"pattern":"dots","strength":"faint"}',
      })
    )
    expect(own.label).toBe('Roadmap page background: Pattern')
    expect(own.design.layout.pageBackgrounds?.roadmap).toEqual({
      kind: 'pattern',
      pattern: 'dots',
      strength: 'faint',
    })
    expect(own.design.layout.background).toBeUndefined()
    const reset = ok(
      applyOp(own.design, MODEL, { op: 'background', target: 'roadmap', key: 'reset', value: '' })
    )
    expect(reset.design.layout.pageBackgrounds).toBeUndefined()
    expect(reset.label).toBe('Roadmap page background: as every page')
  })

  it('keeps a background’s other settings when one is changed', () => {
    const first = ok(
      applyOp(base(), MODEL, {
        op: 'background',
        target: 'site',
        key: 'gradient',
        value: '{"stops":["accent","support"],"shape":"radial"}',
      })
    ).design
    const stronger = ok(
      applyOp(first, MODEL, {
        op: 'background',
        target: 'site',
        key: 'gradient',
        value: '{"strength":"strong"}',
      })
    ).design
    expect(stronger.layout.background).toEqual({
      kind: 'gradient',
      stops: ['accent', 'support'],
      shape: 'radial',
      strength: 'strong',
    })
  })

  it('goes back to the page colour, leaving designs as they were stored', () => {
    const tinted = ok(
      applyOp(base(), MODEL, { op: 'background', target: 'site', key: 'tint', value: '' })
    ).design
    expect(tinted.layout.background).toEqual({ kind: 'tint', colour: 'accent' })
    const plain = ok(
      applyOp(tinted, MODEL, { op: 'background', target: 'site', key: 'solid', value: '' })
    ).design
    expect(plain).toEqual(base())
  })

  it('gives dark mode its own, and back to one worked out from light', () => {
    const tinted = ok(
      applyOp(base(), MODEL, { op: 'background', target: 'site', key: 'tint', value: '' })
    ).design
    const dark = ok(
      applyOp(tinted, MODEL, {
        op: 'background',
        target: 'site',
        key: 'dark',
        value: '{"kind":"gradient","stops":["accent","page"],"shape":"radial"}',
      })
    )
    expect(dark.label).toBe('Page background: Gradient in dark')
    expect(dark.design.layout.background?.dark).toEqual({
      kind: 'gradient',
      stops: ['accent', 'page'],
      shape: 'radial',
    })
    const auto = ok(
      applyOp(dark.design, MODEL, { op: 'background', target: 'site', key: 'dark', value: 'auto' })
    )
    expect(auto.design.layout.background).toEqual({ kind: 'tint', colour: 'accent' })
  })

  it('never adds a picture, but changes how an uploaded one shows', () => {
    const refused = applyOp(base(), MODEL, {
      op: 'background',
      target: 'site',
      key: 'image',
      value: '{"strength":40}',
    })
    expect(refused).toEqual({
      ok: false,
      refusal:
        'I can’t add a picture myself. Upload one in Theme, under Page background, and I can change how it shows.',
    })
    const smuggled = applyOp(base(), MODEL, {
      op: 'background',
      target: 'site',
      key: 'image',
      value: JSON.stringify({ image: { key: IMAGE } }),
    })
    expect(smuggled.ok).toBe(false)
    const uploaded = base()
    uploaded.layout.background = { kind: 'image', image: { key: IMAGE } }
    const softer = ok(
      applyOp(uploaded, MODEL, {
        op: 'background',
        target: 'site',
        key: 'image',
        value: '{"strength":"20","fit":"tile"}',
      })
    )
    expect(softer.design.layout.background).toEqual({
      kind: 'image',
      image: { key: IMAGE },
      strength: 20,
      fit: 'tile',
    })
  })

  it('refuses in plain words what a background cannot be', () => {
    const refusal = (op: Parameters<typeof applyOp>[2]) => {
      const result = applyOp(base(), MODEL, op)
      return result.ok ? null : result.refusal
    }
    expect(refusal({ op: 'background', target: 'settings', key: 'tint' })).toMatch(
      /^A page background can be for every page \("site"\), or home, feedback/
    )
    expect(refusal({ op: 'background', target: 'site', key: 'video' })).toMatch(
      /^A page background is solid \(the page colour\), tint, gradient, pattern or image/
    )
    expect(
      refusal({ op: 'background', target: 'site', key: 'tint', value: '{"direction":"down"}' })
    ).toBe('A tint background has no direction; it takes colour and strength')
    expect(
      refusal({ op: 'background', target: 'site', key: 'gradient', value: '{"stops":["accent"]}' })
    ).toMatch(/^Page background: /)
    expect(
      refusal({ op: 'background', target: 'site', key: 'tint', value: '{"colour":"sky-ish"}' })
    ).toMatch(/^Page background: "sky-ish" is not a colour/)
  })

  it('stays out of a request narrowed to another part', () => {
    const outcome = applyOps(
      base(),
      MODEL,
      [{ op: 'background', target: 'site', key: 'tint', value: '' }],
      { scope: 'band' }
    )
    expect(outcome.outOfScope).toHaveLength(1)
    const site = applyOps(base(), MODEL, [
      { op: 'background', target: 'help center', key: 'tint', value: '{"colour":"#eef4ff"}' },
    ])
    expect(site.applied.map((change) => change.path)).toEqual(['layout.pageBackgrounds'])
    expect(site.applied[0]!.label).toBe('Help Center page background: Soft colour')
    // A background changes as one, however many of its settings moved.
    const whole = applyOps(base(), MODEL, [
      {
        op: 'background',
        target: 'site',
        key: 'gradient',
        value: '{"stops":["#dbeafe","page"],"direction":"down"}',
      },
    ])
    expect(whole.applied.map((change) => change.path)).toEqual(['layout.background'])
  })
})

describe('what Quackback AI is told of page backgrounds', () => {
  it('lists each kind and setting with what it looks like', async () => {
    const { aiCatalogue } = await import('../design-context')
    const text = aiCatalogue({ blockTypes: [], places: WORLD.places })
    expect(text).toContain('The page background, behind every page or one page (op background):')
    expect(text).toContain('gradient (two or three colours running softly into each other')
    expect(text).toContain('radial (a soft glow of the first colour fading out into the last)')
    expect(text).toContain('only a person uploads one')
  })

  it('keeps every example it shows valid', async () => {
    const { PAGE_BACKGROUND_EXAMPLES } = await import('../blocks')
    for (const example of PAGE_BACKGROUND_EXAMPLES) {
      let doc = base()
      doc.layout.pageBackgrounds = { changelog: { kind: 'tint', colour: 'accent' } }
      doc = portalDesign.parse(doc)
      const outcome = applyOps(doc, MODEL, example.ops)
      expect(outcome.refused, example.request).toEqual([])
    }
  })

  it('says what the backgrounds are now', async () => {
    const { designContext } = await import('../design-context')
    const doc = base()
    doc.layout.background = { kind: 'tint', colour: 'accent', dark: { kind: 'solid' } }
    doc.layout.pageBackgrounds = { roadmap: { kind: 'pattern', pattern: 'grid' } }
    const text = designContext(portalDesign.parse(doc), { gates: GATES, places: WORLD.places })
    expect(text).toContain(
      'Page background now: every page soft colour (tint): colour accent; in dark page colour (solid); Roadmap has its own: pattern (pattern): pattern grid.'
    )
  })
})
