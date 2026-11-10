import { describe, expect, it } from 'vitest'
import { chipChange, lookChanges, matchParts } from '../match-steps'

const change = (path: string, before: unknown = 'a', after: unknown = 'b') =>
  ({ path, before, after }) as never

describe('matchParts', () => {
  it('splits a match into brand, hero, and Home and words', () => {
    const parts = matchParts([
      change('brand.light.accent'),
      change('brand.fonts.heading'),
      change('layout.hero'),
      change('brand.heroImage'),
      change('pages.home.copy'),
      change('nav.home.on', false, true),
      change('pages.home.blocks'),
      change('shape.corners'),
    ])
    expect(parts.map((p) => [p.part, p.changes.map((c: { path: string }) => c.path)])).toEqual([
      ['brand', ['brand.light.accent', 'brand.fonts.heading', 'shape.corners']],
      ['hero', ['layout.hero', 'brand.heroImage']],
      ['words', ['pages.home.copy', 'nav.home.on', 'pages.home.blocks']],
    ])
  })

  it('leaves out a part with nothing in it', () => {
    expect(matchParts([change('layout.hero')]).map((p) => p.part)).toEqual(['hero'])
  })
})

describe('chipChange', () => {
  it('makes the one-field follow-ups directly', () => {
    expect(chipChange('Black buttons')).toEqual([{ path: 'shape.fill', value: 'ink' }])
    expect(chipChange('White buttons')).toEqual([{ path: 'shape.fill', value: 'ink' }])
    expect(chipChange('Blue buttons')).toEqual([{ path: 'shape.fill', value: 'accent' }])
    expect(chipChange('Calmer hero')).toEqual([{ path: 'layout.hero', value: 'tint' }])
    expect(chipChange('Bolder hero')).toEqual([{ path: 'layout.hero', value: 'brand' }])
  })

  it('leaves open-ended follow-ups as requests', () => {
    expect(chipChange('Use more blue')).toBeNull()
    expect(chipChange('Use blue for links')).toBeNull()
    expect(chipChange('Add a hero photo')).toBeNull()
  })
})

describe('lookChanges', () => {
  const match = [
    change('brand.light.accent', '#000', '#00f'),
    change('layout.hero', 'none', 'brand'),
    change('brand.matchedAt', null, 'x'),
  ]
  const one = { description: 'Calm', changes: [change('brand.light.accent', '#000', '#0a0')] }
  const two = { description: 'Bold', changes: [change('shape.corners', 'square', 'pill')] }

  it('sets the look and puts back what only the match or another look set', () => {
    expect(lookChanges(match, [one, two], one)).toEqual([
      { path: 'brand.light.accent', value: '#0a0' },
      { path: 'layout.hero', value: 'none' },
      { path: 'shape.corners', value: 'square' },
    ])
    expect(lookChanges(match, [one, two], two)).toEqual([
      { path: 'brand.light.accent', value: '#000' },
      { path: 'layout.hero', value: 'none' },
      { path: 'shape.corners', value: 'pill' },
    ])
  })
})
