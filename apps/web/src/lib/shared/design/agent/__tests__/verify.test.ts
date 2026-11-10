/**
 * What the loop's checks call met: colours as browsers report them, a
 * darker hover by a step the eye sees, a subtle shadow by its opacity and
 * blur, readable text by its contrast, and nothing judged on an element the
 * page does not show.
 */
import { describe, expect, it } from 'vitest'
import { lightness, parseCssColour, shadowStrength } from '../css-values'
import { STYLE_REGISTRY, targetKey, type StyleTarget } from '../style-registry'
import {
  evaluateCheck,
  readabilityChecks,
  type ElementReading,
  type Readings,
  type StyleCheck,
} from '../verify'

const at = (element: string, state: StyleTarget['state'] = 'base', block = '') => ({
  element,
  state,
  block,
})
const reading = (values: Record<string, string>, behind = '#ffffff'): ElementReading => ({
  found: true,
  values,
  behind,
})
const readings = (entries: Array<[StyleTarget, ElementReading]>): Readings =>
  Object.fromEntries(entries.map(([t, r]) => [targetKey(t), r]))
const check = (c: Partial<StyleCheck> & Pick<StyleCheck, 'element' | 'property' | 'expect'>) =>
  ({ state: 'base', block: '', value: '', ...c }) as StyleCheck
const judge = (c: StyleCheck, now: Readings, before: Readings | null = null) =>
  evaluateCheck(STYLE_REGISTRY, c, now, before)

describe('reading computed colours', () => {
  it('reads every form a browser reports', () => {
    expect(parseCssColour('rgb(79, 70, 229)')).toEqual({ hex: '#4f46e5', alpha: 1 })
    expect(parseCssColour('rgba(0, 0, 0, 0.5)')).toEqual({ hex: '#000000', alpha: 0.5 })
    expect(parseCssColour('rgb(0 0 0 / 25%)')).toEqual({ hex: '#000000', alpha: 0.25 })
    expect(parseCssColour('color(srgb 1 0 0)')).toEqual({ hex: '#ff0000', alpha: 1 })
    expect(parseCssColour('transparent')!.alpha).toBe(0)
    expect(parseCssColour('#abc')!.hex).toBe('#aabbcc')
    // White and black through oklch and oklab.
    expect(parseCssColour('oklch(1 0 0)')!.hex).toBe('#ffffff')
    expect(parseCssColour('oklab(0 0 0 / 0.4)')).toEqual({ hex: '#000000', alpha: 0.4 })
    expect(parseCssColour('var(--x)')).toBeNull()
  })

  it('orders lightness as the eye does', () => {
    expect(lightness('#4f46e5')).toBeGreaterThan(lightness('#3730a3'))
  })

  it('reads a shadow by its strongest layer, ignoring an empty one', () => {
    const soft = shadowStrength(
      'rgba(0, 0, 0, 0.06) 0px 1px 2px 0px, rgba(0, 0, 0, 0.08) 0px 1px 3px 0px'
    )
    expect(soft).toEqual({ present: true, alpha: 0.08, blur: 3, offset: 1 })
    expect(shadowStrength('none').present).toBe(false)
    expect(shadowStrength('rgba(0, 0, 0, 0) 0px 0px 0px 0px').present).toBe(false)
  })
})

describe('checks', () => {
  it('meets a darker hover by a measurable step, and says by how much', () => {
    const now = readings([
      [at('button'), reading({ background: 'rgb(79, 70, 229)', color: 'rgb(255, 255, 255)' })],
      [
        at('button', 'hover'),
        reading({ background: 'rgb(55, 48, 163)', color: 'rgb(255, 255, 255)' }),
      ],
    ])
    const result = judge(
      check({ element: 'button', state: 'hover', property: 'background', expect: 'darker' }),
      now
    )
    expect(result.ok).toBe(true)
    expect(result.saw).toMatch(
      /Main buttons on hover: background #3730a3 is \d+% darker than at rest/
    )
  })

  it('fails a hover barely darker than at rest', () => {
    const now = readings([
      [at('button'), reading({ background: '#4f46e5' })],
      [at('button', 'hover'), reading({ background: '#4e45e4' })],
    ])
    const result = judge(
      check({ element: 'button', state: 'hover', property: 'background', expect: 'darker' }),
      now
    )
    expect(result.ok).toBe(false)
    expect(result.saw).toContain('only')
  })

  it('compares an element at rest with the design before the request', () => {
    const before = readings([[at('card'), reading({ radius: '8px' })]])
    const now = readings([[at('card'), reading({ radius: '16px' })]])
    expect(
      judge(check({ element: 'card', property: 'radius', expect: 'more' }), now, before).ok
    ).toBe(true)
    expect(
      judge(check({ element: 'card', property: 'radius', expect: 'less' }), now, before).ok
    ).toBe(false)
  })

  it('calls a faint shadow subtle and a deep one not', () => {
    const subtle = readings([
      [at('card'), reading({ shadow: 'rgba(0, 0, 0, 0.06) 0px 1px 2px 0px' })],
    ])
    const deep = readings([
      [at('card'), reading({ shadow: 'rgba(0, 0, 0, 0.35) 0px 20px 40px 0px' })],
    ])
    const c = check({ element: 'card', property: 'shadow', expect: 'subtle' })
    expect(judge(c, subtle).ok).toBe(true)
    expect(judge(c, deep).ok).toBe(false)
    expect(judge(check({ element: 'card', property: 'shadow', expect: 'none' }), subtle).ok).toBe(
      false
    )
  })

  it('reads text on its own fill, or what is behind when it has none', () => {
    const poor = readings([
      [at('button', 'hover'), reading({ background: '#c7d2fe', color: '#ffffff' })],
    ])
    const c = check({ element: 'button', state: 'hover', property: 'color', expect: 'readable' })
    const result = judge(c, poor)
    expect(result.ok).toBe(false)
    expect(result.saw).toMatch(/reads 1\.\d:1 \(needs 4\.5:1\)/)
    const onPage = readings([
      [
        at('button', 'hover'),
        reading({ background: 'rgba(0, 0, 0, 0)', color: '#111111' }, '#ffffff'),
      ],
    ])
    expect(judge(c, onPage).ok).toBe(true)
  })

  it('calls an edge subtle when it barely stands off what is behind', () => {
    const now = readings([[at('card'), reading({ borderColor: '#26262b' }, '#1c1c21')]])
    expect(
      judge(check({ element: 'card', property: 'borderColor', expect: 'subtle' }), now).ok
    ).toBe(true)
    const loud = readings([[at('card'), reading({ borderColor: '#ffffff' }, '#1c1c21')]])
    expect(
      judge(check({ element: 'card', property: 'borderColor', expect: 'subtle' }), loud).ok
    ).toBe(false)
  })

  it('takes a colour as equal within a small distance and a radius as a pill past 99px', () => {
    const now = readings([[at('button'), reading({ background: '#111827', radius: '9999px' })]])
    expect(
      judge(
        check({ element: 'button', property: 'background', expect: 'is', value: '#111828' }),
        now
      ).ok
    ).toBe(true)
    expect(
      judge(
        check({ element: 'button', property: 'background', expect: 'is', value: '#4f46e5' }),
        now
      ).ok
    ).toBe(false)
    expect(
      judge(check({ element: 'button', property: 'radius', expect: 'is', value: '999' }), now).ok
    ).toBe(true)
  })

  it('calls a page dark by its lightness', () => {
    const now = readings([[at('page'), reading({ background: 'rgb(13, 14, 18)' })]])
    expect(judge(check({ element: 'page', property: 'background', expect: 'dark' }), now).ok).toBe(
      true
    )
    expect(judge(check({ element: 'page', property: 'background', expect: 'light' }), now).ok).toBe(
      false
    )
  })

  it('neither meets nor fails what the page does not show', () => {
    const now = readings([[at('vote', 'current'), { found: false, values: {}, behind: null }]])
    const result = judge(
      check({ element: 'vote', state: 'current', property: 'background', expect: 'present' }),
      now
    )
    expect(result.ok).toBeNull()
    expect(result.saw).toContain('not on the page checked')
  })

  it('adds a readability check for every fill or text colour styled, once', () => {
    const checks = readabilityChecks([
      { ...at('button', 'hover'), property: 'background' },
      { ...at('button', 'hover'), property: 'color' },
      { ...at('card'), property: 'shadow' },
      { ...at('page'), property: 'background' },
    ])
    expect(checks).toEqual([
      { ...at('button', 'hover'), property: 'color', expect: 'readable', value: '' },
    ])
  })
})
