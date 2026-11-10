/**
 * An exact colour set in light mode, in a design that shows dark too, is
 * drawn in dark mode as its dark counterpart: the brand role it matches in
 * that role's dark colour, white and black as the card and the text, and any
 * other colour with its lightness mirrored from the light page to the dark
 * one. A dark value of its own still wins.
 */
import { describe, expect, it } from 'vitest'
import { hexToOklch } from '@/lib/shared/theme/colors'
import { parseOklch } from '@/lib/shared/theme/expand'
import { designChecks } from '../checks'
import { contrastRatio } from '../contrast'
import { resolveDesign } from '../resolve'
import { defaultDesign, type PortalDesign } from '../schema'

function auto(change: (d: PortalDesign) => void): PortalDesign {
  const d = defaultDesign()
  d.mode = 'auto'
  change(d)
  return d
}

const lightnessOf = (c: string) => parseOklch(c.startsWith('#') ? hexToOklch(c) : c)!.l

describe('an exact colour in dark mode', () => {
  it('draws white as the card and black as the text', () => {
    const r = resolveDesign(
      auto((d) => (d.style = { panel: { base: { background: '#ffffff', color: '#000000' } } }))
    )
    expect(r.tokens.light['--qb-st-panel-base-background']).toBe('#ffffff')
    expect(r.tokens.dark['--qb-st-panel-base-background']).toBe(r.dark!.card)
    expect(r.tokens.dark['--qb-st-panel-base-color']).toBe(r.dark!.foreground)
  })

  it('draws a colour that is a brand role as that role’s dark colour', () => {
    const d = auto((d) => {
      d.brand.light.accent = '#1e3a8a'
      d.style = { panel: { base: { background: '#1e3a8a' } } }
    })
    const r = resolveDesign(d)
    // Dark mode lightens a deep brand colour so it reads on the dark page.
    expect(r.dark!.primary).not.toBe('#1e3a8a')
    expect(r.tokens.dark['--qb-st-panel-base-background']).toBe(r.dark!.primary)
  })

  it('mirrors any other colour’s lightness from the light page to the dark one', () => {
    const r = resolveDesign(auto((d) => (d.style = { panel: { base: { background: '#e0f2fe' } } })))
    const drawn = r.tokens.dark['--qb-st-panel-base-background']!
    expect(drawn).not.toBe('#e0f2fe')
    expect(lightnessOf(drawn)).toBeLessThan(0.4)
    // Its text reads on it.
    const check = r.styled.find((c) => c.where === 'style.panel.base' && c.mode === 'dark')
    if (check?.used) expect(contrastRatio(check.used, drawn)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps a dark value of its own', () => {
    const r = resolveDesign(
      auto((d) => {
        d.style = { panel: { base: { background: '#ffffff' } } }
        d.styleDark = { panel: { base: { background: '#123456' } } }
      })
    )
    expect(r.tokens.dark['--qb-st-panel-base-background']).toBe('#123456')
  })

  it('keeps the colour as set in a design that shows only dark', () => {
    const d = defaultDesign()
    d.mode = 'dark'
    d.style = { panel: { base: { background: '#e0f2fe' } } }
    expect(resolveDesign(d).tokens.dark['--qb-st-panel-base-background']).toBe('#e0f2fe')
  })
})

describe('the light panel in dark mode check', () => {
  const lightInDark = () =>
    auto((d) => {
      d.style = { postCard: { base: { background: '#ffffff' } } }
      d.styleDark = { postCard: { base: { background: '#f8fafc' } } }
    })

  it('names a panel drawn light on the dark page, with a fix that draws it as a card', () => {
    const check = designChecks(lightInDark()).find((c) => c.id.startsWith('light-panel'))
    expect(check?.text).toBe('Post cards stay light in dark mode.')
    expect(check?.part).toBe('site:styles')
    const fixed = lightInDark()
    check!.fix!.apply(fixed)
    expect(fixed.styleDark?.postCard?.base?.background).toBe('surface')
    expect(designChecks(fixed).some((c) => c.id.startsWith('light-panel'))).toBe(false)
  })

  it('says nothing of a panel that is dark in dark mode, or a design without dark', () => {
    expect(
      designChecks(auto((d) => (d.style = { postCard: { base: { background: '#ffffff' } } }))).some(
        (c) => c.id.startsWith('light-panel')
      )
    ).toBe(false)
    const light = lightInDark()
    light.mode = 'light'
    expect(designChecks(light).some((c) => c.id.startsWith('light-panel'))).toBe(false)
  })
})
