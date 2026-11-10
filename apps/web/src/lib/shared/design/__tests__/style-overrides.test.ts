/**
 * Element overrides: a look for one page or one part, validated against the
 * registry as `style` is, one per target, addressable by path, and kept
 * (shown as orphaned) when the part they name is gone.
 */
import { describe, expect, it } from 'vitest'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'
import {
  MAX_OVERRIDES,
  clearOverride,
  findOverride,
  overrideIdOf,
  overridePath,
  overridePaths,
  setOverrideValue,
  type OverrideTarget,
} from '../style-overrides'
import { orphanedOverrides } from '../override-cascade'

const parse = (change: (d: PortalDesign) => void) => {
  const d = defaultDesign()
  change(d)
  return portalDesign.safeParse(d)
}

const heroCta: OverrideTarget = { scope: 'part', part: 'hero.home.cta', element: 'button' }
const feedbackButtons: OverrideTarget = { scope: 'page', page: 'feedback', element: 'button' }

describe('the overrides schema', () => {
  it('takes a page override and a part override, with dark colours and phone sizes', () => {
    const result = parse((d) => {
      d.overrides = [
        {
          id: 'anything',
          target: feedbackButtons,
          style: { base: { background: 'support', radius: 4 }, hover: { background: '#112233' } },
          styleDark: { base: { background: '#334455' } },
          phone: { base: { height: 44, paddingX: 10 } },
        },
        { id: 'x', target: heroCta, style: { base: { radius: 0 } } },
      ]
    })
    expect(result.success).toBe(true)
    // Ids are written from the target, whatever was sent.
    expect(result.data!.overrides!.map((o) => o.id)).toEqual([
      'page:feedback:button',
      'part:hero.home.cta:button',
    ])
  })

  it('refuses what the registry does not allow', () => {
    const bad = [
      // A property the element does not have.
      { target: feedbackButtons, style: { base: { leading: 1.4 } } },
      // A state the element does not have.
      {
        target: { scope: 'page', page: 'home', element: 'headline' },
        style: { hover: { size: 20 } },
      },
      // An element that does not exist.
      { target: { scope: 'page', page: 'home', element: 'banner' }, style: { base: {} } },
      // A page that does not exist.
      {
        target: { scope: 'page', page: 'admin', element: 'button' },
        style: { base: { radius: 1 } },
      },
      // Colours on a phone, and sizes in dark mode.
      { target: feedbackButtons, phone: { base: { background: 'accent' } } },
      { target: feedbackButtons, styleDark: { base: { radius: 4 } } },
      // A value out of range, and a part name that is a DOM path.
      { target: feedbackButtons, style: { base: { radius: -1 } } },
      {
        target: { scope: 'part', part: 'div > button', element: 'button' },
        style: { base: { radius: 1 } },
      },
      // An unknown key.
      { target: feedbackButtons, style: { base: { radius: 1 } }, extra: true },
    ]
    for (const o of bad)
      expect(
        parse((d) => void (d.overrides = [{ id: 'x', ...o } as never])).success,
        JSON.stringify(o)
      ).toBe(false)
  })

  it('takes one override per target, and at most 200', () => {
    expect(
      parse((d) => {
        d.overrides = [
          { id: 'a', target: heroCta, style: { base: { radius: 1 } } },
          { id: 'b', target: heroCta, style: { base: { radius: 2 } } },
        ]
      }).success
    ).toBe(false)
    const many = Array.from({ length: MAX_OVERRIDES + 1 }, (_, i) => ({
      id: String(i),
      target: { scope: 'part' as const, part: `nav.link.l${i}`, element: 'navItem' as const },
      style: { base: { radius: 1 } },
    }))
    expect(parse((d) => void (d.overrides = many)).success).toBe(false)
    expect(parse((d) => void (d.overrides = many.slice(0, MAX_OVERRIDES))).success).toBe(true)
  })

  it('leaves out empty states and empty overrides', () => {
    const result = parse((d) => {
      d.overrides = [
        { id: 'a', target: heroCta, style: { base: { radius: 1 }, hover: {} } },
        { id: 'b', target: feedbackButtons, style: { base: {} } },
      ]
    })
    expect(result.data!.overrides).toEqual([
      { id: 'part:hero.home.cta:button', target: heroCta, style: { base: { radius: 1 } } },
    ])
  })

  it('takes phone values at the site and in a block', () => {
    expect(
      parse((d) => {
        d.stylePhone = { headline: { base: { size: 28 } } }
      }).success
    ).toBe(true)
    expect(
      parse((d) => void (d.stylePhone = { headline: { base: { color: 'accent' } } })).success
    ).toBe(false)
    expect(
      parse((d) => {
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
      }).success
    ).toBe(true)
  })
})

describe('writing overrides', () => {
  it('makes an override on the first value and drops it with the last', () => {
    const d: PortalDesign = defaultDesign()
    expect(setOverrideValue(d, heroCta, 'style', 'hover', 'background', 'accent')).toBe(true)
    expect(findOverride(d, heroCta)?.style).toEqual({ hover: { background: 'accent' } })
    expect(setOverrideValue(d, heroCta, 'phone', 'base', 'height', 44)).toBe(true)
    setOverrideValue(d, heroCta, 'style', 'hover', 'background', undefined)
    expect(findOverride(d, heroCta)).toEqual({
      id: overrideIdOf(heroCta),
      target: heroCta,
      phone: { base: { height: 44 } },
    })
    setOverrideValue(d, heroCta, 'phone', 'base', 'height', undefined)
    expect(d.overrides).toBeUndefined()
  })

  it('refuses a value the element or the layer cannot hold', () => {
    const d: PortalDesign = defaultDesign()
    expect(setOverrideValue(d, heroCta, 'phone', 'base', 'background', 'accent')).toBe(false)
    expect(setOverrideValue(d, heroCta, 'style', 'current', 'background', 'accent')).toBe(false)
    expect(d.overrides).toBeUndefined()
  })

  it('clears one override', () => {
    const d: PortalDesign = defaultDesign()
    setOverrideValue(d, heroCta, 'style', 'base', 'radius', 0)
    setOverrideValue(d, feedbackButtons, 'style', 'base', 'radius', 0)
    clearOverride(d, heroCta)
    expect(d.overrides!.map((o) => o.id)).toEqual(['page:feedback:button'])
  })

  it('addresses each value by path, as style is', () => {
    const d: PortalDesign = defaultDesign()
    setOverrideValue(d, heroCta, 'style', 'hover', 'background', 'accent')
    const [path] = overridePaths(d.overrides![0]!)
    expect(path).toBe('overrides.part:hero.home.cta:button.style.hover.background')
    expect(overridePath(path!)).toEqual({
      id: 'part:hero.home.cta:button',
      target: heroCta,
      layer: 'style',
      state: 'hover',
      prop: 'background',
    })
    expect(overridePath('overrides.page:feedback:button.phone.base.background')).toBeNull()
    expect(overridePath('overrides.page:nowhere:button.style.base.radius')).toBeNull()
  })
})

describe('orphaned overrides', () => {
  it('are those whose part or block is gone, kept in the design', () => {
    const d = portalDesign.parse({
      ...defaultDesign(),
      pages: {
        ...defaultDesign().pages,
        home: {
          headline: null,
          blocks: [{ type: 'ideas', id: 'abcdefgh', sort: 'top', count: 3 }],
        },
      },
      overrides: [
        {
          id: '',
          target: { scope: 'part', part: 'block.abcdefgh.heading', element: 'heading' },
          style: { base: { size: 20 } },
        },
        {
          id: '',
          target: { scope: 'part', part: 'block.zzzzzzzz.heading', element: 'heading' },
          style: { base: { size: 20 } },
        },
        {
          id: '',
          target: { scope: 'part', part: 'nav.link.gone', element: 'navItem' },
          style: { base: { weight: 700 } },
        },
        { id: '', target: feedbackButtons, style: { base: { radius: 2 } } },
      ],
    })
    expect(d.overrides).toHaveLength(4)
    expect(orphanedOverrides(d).map((o) => o.id)).toEqual([
      'part:block.zzzzzzzz.heading:heading',
      'part:nav.link.gone:navItem',
    ])
  })

  it('include a part override for an element kind the part is not', () => {
    const d = portalDesign.parse({
      ...defaultDesign(),
      overrides: [
        {
          id: '',
          target: { scope: 'part', part: 'footer', element: 'button' },
          style: { base: { radius: 2 } },
        },
      ],
    })
    expect(orphanedOverrides(d)).toHaveLength(1)
  })
})
