/**
 * The adapter from styles to the design's operations: a style the design has
 * an exact value for goes to that field; a state, one block or a property
 * without one becomes a style token (never CSS); relative colours are a step
 * the eye sees; roles stay roles; every refusal says why; and a step's
 * changes are labelled as the style said.
 */
import { describe, expect, it } from 'vitest'
import { defaultDesign, portalDesign, type PortalDesign } from '../../schema'
import type { OpWorld } from '../../design-ops'
import { lightness } from '../css-values'
import { staticReading } from '../static-reading'
import { applyStep, mergeChanges, planStyle, stylesAsOps, type StyleOp } from '../style-ops'
import { STYLE_REGISTRY } from '../style-registry'

const R = STYLE_REGISTRY

function design(): PortalDesign {
  const d = defaultDesign()
  d.brand.light.accent = '#4f46e5'
  d.pages.home.blocks = [
    {
      id: 'ideas00001',
      type: 'ideas',
      sort: 'trending',
      count: 3,
      grid: { x: 0, y: 0, w: 12, h: 1 },
    },
    { id: 'roadmap001', type: 'roadmap', roadmapId: null, grid: { x: 0, y: 1, w: 12, h: 1 } },
  ] as PortalDesign['pages']['home']['blocks']
  return portalDesign.parse(d)
}

const style = (s: Partial<StyleOp> & Pick<StyleOp, 'element' | 'property' | 'value'>): StyleOp => ({
  state: 'base',
  block: '',
  ...s,
})

const world = (css: 'allow' | 'refuse' = 'allow'): OpWorld => ({
  gates: {
    feedback: true,
    roadmap: true,
    changelog: true,
    help: true,
    support: true,
    status: true,
  },
  places: { boards: [], roadmaps: [], categories: [] },
  untrusted: {
    blockTypes: ['ideas', 'roadmap'],
    links: new Set(),
    checkCss: () => (css === 'allow' ? null : 'Quackback AI does not write CSS'),
  },
})

describe('planning a style', () => {
  it('sends a style at rest with a field to that field', () => {
    const plan = planStyle(
      design(),
      R,
      style({ element: 'button', property: 'background', value: '#111827' })
    )
    expect(plan).toMatchObject({
      ok: true,
      plan: {
        kind: 'field',
        path: 'tune.button.fill',
        ops: [{ op: 'theme', key: 'button.fill', value: '"#111827"' }],
      },
    })
    const shadow = planStyle(
      design(),
      R,
      style({ element: 'card', property: 'shadow', value: 'subtle' })
    )
    expect(shadow).toMatchObject({ ok: true, plan: { kind: 'field', path: 'tune.card.shadow' } })
  })

  it('writes a state as a style token', () => {
    const plan = planStyle(
      design(),
      R,
      style({ element: 'button', state: 'hover', property: 'background', value: 'darker' })
    )
    expect(plan.ok).toBe(true)
    if (!plan.ok || plan.plan.kind !== 'token') throw new Error('expected a token')
    expect(plan.plan.ops[0]).toMatchObject({ op: 'theme', key: 'style.button.hover.background' })
    const hex = JSON.parse(plan.plan.ops[0]!.value!) as string
    // Darker than the brand colour by a step the eye sees.
    expect(lightness('#4f46e5') - lightness(hex)).toBeGreaterThanOrEqual(0.04)
  })

  it('narrows a style to one Home block by its type or name', () => {
    const plan = planStyle(
      design(),
      R,
      style({ element: 'block', block: 'Roadmap', property: 'borderWidth', value: '2' })
    )
    if (!plan.ok || plan.plan.kind !== 'token') throw new Error('expected a token')
    // Each block of that type, in its own look.
    expect(plan.plan.ops).toEqual([
      { op: 'set', target: 'roadmap001', key: 'style.block.base.borderWidth', value: '2' },
    ])
  })

  it('refuses in plain words what the registry or the design does not have', () => {
    const refusal = (s: StyleOp) => {
      const plan = planStyle(design(), R, s)
      return plan.ok ? null : plan.refusal
    }
    expect(refusal(style({ element: 'cape', property: 'color', value: '#000' }))).toMatch(
      /no element cape/
    )
    expect(
      refusal(style({ element: 'headline', state: 'hover', property: 'color', value: '#000' }))
    ).toMatch(/no hover state/)
    expect(refusal(style({ element: 'card', property: 'size', value: '14' }))).toMatch(
      /cannot take size/
    )
    expect(refusal(style({ element: 'card', property: 'shadow', value: 'glowing' }))).toMatch(
      /shadow can be/
    )
    expect(
      refusal(style({ element: 'navItem', block: 'roadmap', property: 'color', value: '#000' }))
    ).toMatch(/cannot be styled apart/)
    expect(refusal(style({ element: 'button', property: 'height', value: '200' }))).toMatch(
      /24 to 72px/
    )
    expect(refusal(style({ element: 'card', property: 'background', value: 'teal-ish' }))).toMatch(
      /not a colour/
    )
    expect(
      refusal(style({ element: 'card', block: 'status', property: 'radius', value: '4' }))
    ).toMatch(/no status block/)
  })

  it('takes roles and named weights', () => {
    const role = planStyle(
      design(),
      R,
      style({ element: 'link', state: 'hover', property: 'color', value: 'accent' })
    )
    // A role stays a role, so dark mode draws its own.
    expect(role.ok && role.plan.ops[0]).toMatchObject({
      key: 'style.link.hover.color',
      value: '"accent"',
    })
    const text = planStyle(
      design(),
      R,
      style({ element: 'link', state: 'hover', property: 'color', value: 'text' })
    )
    expect(text.ok && text.plan.ops[0]!.value).toBe('"ink"')
    const weight = planStyle(
      design(),
      R,
      style({ element: 'headline', property: 'weight', value: 'bold' })
    )
    expect(weight).toMatchObject({ ok: true, plan: { kind: 'field', ops: [{ value: '700' }] } })
  })
})

describe('applying a step', () => {
  it('applies operations then styles, each change labelled as the style says', () => {
    const before = design()
    const out = applyStep(
      before,
      world(),
      R,
      [{ op: 'theme', key: 'cards', value: 'raised' }],
      [
        style({ element: 'button', state: 'hover', property: 'background', value: 'darker' }),
        style({ element: 'button', state: 'hover', property: 'lift', value: '2' }),
        style({ element: 'card', property: 'radius', value: '12' }),
      ]
    )
    expect(out.refused).toEqual([])
    expect(out.design.layout.cards).toBe('raised')
    expect(out.design.tune?.card?.radius).toBe(12)
    expect(out.design.style?.button?.hover?.lift).toBe(2)
    expect(out.design.style?.button?.hover?.background).toMatch(/^#[0-9a-f]{6}$/)
    expect(out.design.css ?? '').toBe('')
    const labels = out.applied.map((c) => c.label).join('; ')
    expect(labels).toMatch(/Main buttons on hover: background darker \(#4f46e5 → #[0-9a-f]{6}\)/)
    expect(labels).toContain('Main buttons on hover: lift 2px')
    expect(out.done).toHaveLength(4)
  })

  it('needs no CSS, so a workspace that takes none still takes styles', () => {
    const out = applyStep(
      design(),
      world('refuse'),
      R,
      [],
      [style({ element: 'button', state: 'hover', property: 'background', value: '#3730a3' })]
    )
    expect(out.refused).toEqual([])
    expect(out.design.style?.button?.hover?.background).toBe('#3730a3')
  })

  it('reads the static preview of a styled hover', () => {
    const out = applyStep(
      design(),
      world(),
      R,
      [],
      [style({ element: 'button', state: 'hover', property: 'background', value: '#3730a3' })]
    )
    const hover = staticReading(out.design, R, { element: 'button', state: 'hover', block: '' })
    const rest = staticReading(out.design, R, { element: 'button', state: 'base', block: '' })
    expect(hover.values.background).toBe('#3730a3')
    expect(rest.values.background).not.toBe('#3730a3')
  })

  it('reads an override where it goes: one part, one page, and nowhere wider', () => {
    const out = applyStep(
      design(),
      world(),
      R,
      [
        {
          op: 'override',
          target: 'part:hero.home.cta',
          key: 'button.base.background',
          value: 'black',
        },
        { op: 'override', target: 'page:roadmap', key: 'button.base.radius', value: '2' },
        { op: 'override', target: 'block:roadmap001', key: 'heading.base.color', value: '#b91c1c' },
      ],
      []
    )
    const at = (element: string, target: string) =>
      staticReading(out.design, R, { element, state: 'base', block: '', target }).values
    expect(at('button', 'part:hero.home.cta').background).toBe('#000000')
    // Text on the black fill is solved to read, as it is drawn.
    expect(at('button', 'part:hero.home.cta').color).toBe('#ffffff')
    expect(at('button', 'page:roadmap').radius).toBe('2px')
    expect(at('button', 'page:roadmap').background).toBe('#4f46e5')
    expect(at('heading', 'block:roadmap001').color).toBe('#b91c1c')
    // Everywhere else keeps the site's look.
    expect(at('button', '').background).toBe('#4f46e5')
    expect(at('button', 'page:changelog').radius).not.toBe('2px')
  })

  it('reads a headline on a lit band as on the band’s own colour', () => {
    const d = design()
    d.mode = 'light'
    d.brand.light.accent = '#fc5f0a'
    d.layout.band = 'brand'
    d.layout.bandGlow = 'bottom'
    const reading = staticReading(d, R, { element: 'headline', state: 'base', block: '' })
    expect(reading.behind).toBe('#fc5f0a')
  })

  it('leaves styles outside a picked part alone', () => {
    const out = applyStep(
      design(),
      world(),
      R,
      [],
      [
        style({ element: 'card', property: 'radius', value: '12' }),
        style({ element: 'button', property: 'radius', value: '4' }),
      ],
      { scope: 'button' }
    )
    expect(out.outOfScope).toEqual(['Cards'])
    expect(out.design.tune?.button?.radius).toBe(4)
  })

  it('turns each style into its token operation', () => {
    const out = stylesAsOps(design(), R, [
      style({ element: 'button', state: 'hover', property: 'background', value: '#3730a3' }),
      style({ element: 'link', state: 'hover', property: 'underline', value: 'underlined' }),
    ])
    expect(out.ops).toEqual([
      { op: 'theme', key: 'style.button.hover.background', value: '"#3730a3"' },
      { op: 'theme', key: 'style.link.hover.underline', value: '"underline"' },
    ])
  })
})

describe('merging changes across steps', () => {
  it('keeps each field once, from before the first change to after the last', () => {
    const a = design()
    const b = structuredClone(a)
    b.layout.cards = 'raised'
    const c = structuredClone(b)
    c.layout.cards = 'filled'
    c.layout.density = 'compact'
    const merged = mergeChanges(a, c, [
      [{ path: 'layout.cards', before: a.layout.cards, after: 'raised', label: 'Cards to raised' }],
      [
        { path: 'layout.cards', before: 'raised', after: 'filled', label: 'Cards to filled' },
        { path: 'layout.density', before: a.layout.density, after: 'compact', label: 'Density' },
      ],
    ])
    expect(merged).toEqual([
      {
        path: 'layout.cards',
        before: a.layout.cards,
        after: 'filled',
        label: 'Cards to raised; Cards to filled',
      },
      { path: 'layout.density', before: a.layout.density, after: 'compact', label: 'Density' },
    ])
    // Changed and changed back: nothing to undo.
    expect(mergeChanges(a, a, [[{ path: 'layout.cards', before: 'x', after: 'y' }]])).toEqual([])
  })
})
