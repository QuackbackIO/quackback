/**
 * What reaches a picked element through the cascade, where each value comes
 * from, where it is written at each scope, and where a wider change is
 * masked.
 */
import { describe, expect, it } from 'vitest'
import {
  alsoSetAt,
  brandValue,
  resetPlace,
  widerValue,
  darkScopes,
  defaultScope,
  readDarkAt,
  writeDarkAt,
  effectiveValue,
  overrideChangeLines,
  scopesFor,
  writeAt,
  readAt,
  type ElementContext,
} from '../override-cascade'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'
import { findOverride } from '../style-overrides'

const BLOCK = 'abcdefgh'
const base = (): PortalDesign =>
  portalDesign.parse({
    ...defaultDesign(),
    pages: {
      ...defaultDesign().pages,
      home: {
        headline: null,
        blocks: [
          { type: 'ideas', id: BLOCK, sort: 'top', count: 3, grid: { x: 0, y: 0, w: 6, h: 2 } },
        ],
      },
    },
  })

const cta: ElementContext = { element: 'button', part: 'hero.home.cta', page: 'home', block: null }
const vote: ElementContext = { element: 'vote', part: null, page: 'home', block: BLOCK }

describe('scopes', () => {
  it('offers this one only for a part, this block inside a block, and starts shared, at the widest', () => {
    expect(scopesFor(cta)).toEqual(['part', 'page', 'everywhere'])
    expect(scopesFor(vote)).toEqual(['block', 'page', 'everywhere'])
    expect(scopesFor({ ...vote, block: null, page: null })).toEqual(['everywhere'])
    expect(defaultScope(cta)).toBe('everywhere')
    expect(defaultScope(vote)).toBe('everywhere')
    expect(defaultScope({ ...vote, block: null, page: null })).toBe('everywhere')
  })
})

describe('dark mode values at a scope', () => {
  it('reads and writes a colour for dark mode everywhere, on a page and on a part, apart from light', () => {
    const d = base()
    writeDarkAt(d, cta, 'everywhere', 'base', 'background', 'black')
    writeDarkAt(d, cta, 'page', 'hover', 'color', 'white')
    writeDarkAt(d, cta, 'part', 'base', 'background', 'surface')
    expect(d.styleDark).toEqual({ button: { base: { background: 'black' } } })
    expect(findOverride(d, 'page:home:button')?.styleDark).toEqual({ hover: { color: 'white' } })
    expect(readDarkAt(d, cta, 'part', 'base', 'background')).toBe('surface')
    expect(readAt(d, cta, 'part', 'all', 'base', 'background')).toBeUndefined()
    writeDarkAt(d, cta, 'everywhere', 'base', 'background', undefined)
    expect(d.styleDark).toBeUndefined()
  })

  it('has none for a Home block, whose look has no dark layer', () => {
    expect(darkScopes(vote)).toEqual(['page', 'everywhere'])
    expect(darkScopes(cta)).toEqual(['part', 'page', 'everywhere'])
  })
})

describe('the value an element has from the brand', () => {
  it('names the brand colour a main button is drawn in where no style sets it', () => {
    const d = base()
    expect(brandValue(d, 'button', 'background')).toBe('accent')
    expect(brandValue(d, 'button', 'color')).toBe('on-accent')
    d.shape.fill = 'ink'
    expect(brandValue(d, 'button', 'background')).toBe('ink')
  })

  it('gives the numbers the brand choices give, and nothing it cannot know', () => {
    const d = base()
    d.shape.buttons = 'pill'
    expect(brandValue(d, 'button', 'radius')).toBe(999)
    expect(brandValue(d, 'button', 'height')).toBeGreaterThan(0)
    expect(brandValue(d, 'button', 'paddingX')).toBeUndefined()
  })
})

describe('writing and reading at a scope', () => {
  it('writes each scope where it belongs, on all screens or phones', () => {
    const d = base()
    writeAt(d, cta, 'part', 'all', 'base', 'radius', 4)
    writeAt(d, cta, 'page', 'all', 'base', 'radius', 8)
    writeAt(d, cta, 'everywhere', 'phone', 'base', 'size', 18)
    writeAt(d, vote, 'block', 'phone', 'base', 'radius', 2)
    expect(d.overrides!.map((o) => o.id)).toEqual(['part:hero.home.cta:button', 'page:home:button'])
    expect(d.stylePhone).toEqual({ button: { base: { size: 18 } } })
    expect(d.pages.home.blocks[0]!.look).toEqual({ phone: { vote: { base: { radius: 2 } } } })
    expect(readAt(d, cta, 'part', 'all', 'base', 'radius')).toBe(4)
    expect(readAt(d, cta, 'everywhere', 'all', 'base', 'radius')).toBeUndefined()
    // Cleared, nothing is left behind.
    writeAt(d, vote, 'block', 'phone', 'base', 'radius', undefined)
    expect(d.pages.home.blocks[0]!.look).toBeUndefined()
    writeAt(d, cta, 'everywhere', 'phone', 'base', 'size', undefined)
    expect(d.stylePhone).toBeUndefined()
  })
})

describe('effective values', () => {
  it('takes the narrowest scope that sets it, and says where it comes from', () => {
    const d = base()
    writeAt(d, cta, 'everywhere', 'all', 'base', 'radius', 2)
    expect(effectiveValue(d, cta, 'all', 'base', 'radius')).toEqual({
      value: 2,
      from: 'everywhere',
      screen: 'all',
    })
    writeAt(d, cta, 'page', 'all', 'base', 'radius', 6)
    expect(effectiveValue(d, cta, 'all', 'base', 'radius')?.from).toBe('page')
    writeAt(d, cta, 'part', 'all', 'base', 'radius', 9)
    expect(effectiveValue(d, cta, 'all', 'base', 'radius')).toEqual({
      value: 9,
      from: 'part',
      screen: 'all',
    })
    expect(effectiveValue(d, cta, 'all', 'base', 'size')).toBeNull()
  })

  it('on a phone, a phone value beats all screens at its scope, not a narrower scope', () => {
    const d = base()
    writeAt(d, cta, 'everywhere', 'phone', 'base', 'size', 14)
    writeAt(d, cta, 'everywhere', 'all', 'base', 'size', 18)
    expect(effectiveValue(d, cta, 'phone', 'base', 'size')).toEqual({
      value: 14,
      from: 'everywhere',
      screen: 'phone',
    })
    expect(effectiveValue(d, cta, 'all', 'base', 'size')?.value).toBe(18)
    writeAt(d, cta, 'page', 'all', 'base', 'size', 20)
    expect(effectiveValue(d, cta, 'phone', 'base', 'size')).toEqual({
      value: 20,
      from: 'page',
      screen: 'all',
    })
  })

  it('in a state, a normal value at a narrower scope beats the state at a wider one', () => {
    const d = base()
    writeAt(d, cta, 'everywhere', 'all', 'hover', 'background', 'support')
    expect(effectiveValue(d, cta, 'all', 'hover', 'background')?.value).toBe('support')
    writeAt(d, cta, 'part', 'all', 'base', 'background', 'accent')
    expect(effectiveValue(d, cta, 'all', 'hover', 'background')).toEqual({
      value: 'accent',
      from: 'part',
      screen: 'all',
    })
  })

  it('reads a block’s look only for its own elements', () => {
    const d = base()
    writeAt(d, vote, 'block', 'all', 'base', 'radius', 3)
    expect(effectiveValue(d, vote, 'all', 'base', 'radius')?.from).toBe('block')
    expect(effectiveValue(d, { ...vote, block: null }, 'all', 'base', 'radius')).toBeNull()
  })
})

describe('also set at', () => {
  it('names the narrower scopes that mask a value set wider', () => {
    const d = base()
    writeAt(d, cta, 'part', 'all', 'base', 'radius', 4)
    writeAt(d, cta, 'page', 'all', 'base', 'radius', 4)
    writeAt(d, { ...cta, page: 'feedback', part: null }, 'page', 'all', 'base', 'radius', 4)
    writeAt(d, vote, 'block', 'all', 'base', 'radius', 4)
    const everywhere = alsoSetAt(d, cta, 'everywhere')
    expect(everywhere.map((a) => a.label)).toEqual(['Home', 'Feedback', 'Call to action · Hero'])
    expect(alsoSetAt(d, cta, 'page').map((a) => a.label)).toEqual(['Call to action · Hero'])
    expect(alsoSetAt(d, cta, 'part')).toEqual([])
    expect(alsoSetAt(d, vote, 'everywhere').map((a) => a.label)).toEqual(['Top posts'])
  })
})

describe('an override change in plain words', () => {
  const withOverride = (fn: (d: PortalDesign) => void) => {
    const d = base()
    fn(d)
    return d
  }

  it('says each value that changed, from what reached it before, and where it reaches', () => {
    const before = base()
    const after = withOverride((d) => writeAt(d, cta, 'part', 'all', 'base', 'background', 'black'))
    expect(overrideChangeLines(after, before.overrides, after.overrides)).toEqual([
      'Call to action background: Brand → Black (this one)',
    ])
  })

  it('names a page override by its page, a state and phones, and a value taken away', () => {
    const roadmap: ElementContext = { element: 'button', part: null, page: 'roadmap', block: null }
    const before = withOverride((d) => {
      d.style = { button: { base: { radius: 8 } } }
      writeAt(d, cta, 'part', 'all', 'base', 'background', 'black')
    })
    const after = withOverride((d) => {
      d.style = { button: { base: { radius: 8 } } }
      writeAt(d, roadmap, 'page', 'all', 'base', 'radius', 999)
      writeAt(d, roadmap, 'page', 'all', 'hover', 'background', '#1e1b4b')
      writeAt(d, roadmap, 'page', 'phone', 'base', 'height', 48)
    })
    expect(overrideChangeLines(after, before.overrides, after.overrides)).toEqual([
      'Call to action background: Black → Brand (this one)',
      'Main buttons on Roadmap corners: 8px → 999px (this page)',
      'Main buttons on Roadmap background on hover: Brand → #1e1b4b (this page)',
      'Main buttons on Roadmap height on phones: Theme default → 48px (this page)',
    ])
  })

  it('does not guess the theme’s colour for a part drawn as one of several kinds', () => {
    const login: ElementContext = {
      element: 'button',
      part: 'header.login',
      page: null,
      block: null,
    }
    const before = base()
    const after = withOverride((d) =>
      writeAt(d, login, 'part', 'all', 'base', 'background', 'black')
    )
    expect(overrideChangeLines(after, before.overrides, after.overrides)).toEqual([
      'Log in button background: Theme default → Black (this one)',
    ])
    // Black and white written as hex read as their names.
    const hex = withOverride((d) => writeAt(d, login, 'part', 'all', 'base', 'color', '#FFFFFF'))
    expect(overrideChangeLines(hex, before.overrides, hex.overrides)).toEqual([
      'Log in button text: Theme default → White (this one)',
    ])
  })

  it('says nothing for overrides that did not change', () => {
    const d = withOverride((x) => writeAt(x, cta, 'part', 'all', 'base', 'background', 'black'))
    expect(overrideChangeLines(d, d.overrides, structuredClone(d.overrides))).toEqual([])
  })
})

describe('what a value goes back to', () => {
  it('is the next wider value that reaches it, or none', () => {
    const d = base()
    writeAt(d, cta, 'everywhere', 'all', 'base', 'radius', 6)
    writeAt(d, cta, 'part', 'all', 'base', 'radius', 2)
    expect(widerValue(d, cta, 'part', 'all', 'base', 'radius')).toEqual({
      value: 6,
      from: 'everywhere',
      screen: 'all',
    })
    expect(widerValue(d, cta, 'everywhere', 'all', 'base', 'radius')).toBeNull()
  })

  it('counts this scope’s normal value for a state, and its all-screens value for phones', () => {
    const d = base()
    writeAt(d, cta, 'page', 'all', 'base', 'radius', 6)
    writeAt(d, cta, 'page', 'all', 'hover', 'radius', 9)
    writeAt(d, cta, 'page', 'phone', 'base', 'radius', 3)
    expect(widerValue(d, cta, 'page', 'all', 'hover', 'radius')?.value).toBe(6)
    expect(widerValue(d, cta, 'page', 'phone', 'base', 'radius')).toEqual({
      value: 6,
      from: 'page',
      screen: 'all',
    })
  })
})

describe('resetting a place set differently', () => {
  it('clears a page’s, a part’s or a block’s own look of an element, and nothing else', () => {
    const d = base()
    writeAt(d, cta, 'everywhere', 'all', 'base', 'radius', 6)
    writeAt(d, cta, 'page', 'all', 'base', 'radius', 8)
    writeAt(d, cta, 'part', 'phone', 'base', 'size', 18)
    writeDarkAt(d, cta, 'part', 'base', 'background', 'black')
    writeAt(d, vote, 'block', 'all', 'base', 'radius', 2)
    const places = alsoSetAt(d, cta, 'everywhere')
    for (const place of places) resetPlace(d, cta.element, place)
    expect(d.overrides).toBeUndefined()
    expect(d.style).toEqual({ button: { base: { radius: 6 } } })
    resetPlace(d, 'vote', { scope: 'block', label: 'Top posts', block: BLOCK })
    expect(d.pages.home.blocks[0]!.look).toBeUndefined()
  })
})
