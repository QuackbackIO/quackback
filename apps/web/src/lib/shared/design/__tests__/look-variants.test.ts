/**
 * Compare looks: Matched, Soft and Vivid of one brand. Each is the brand's
 * own design with only its treatment changed, readable in light and dark,
 * clean by the design checks, and clearly apart from the other two, from any
 * starting design: every preset, every design fixture and a matched brand
 * whose hero is already filled with its colour.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkDesign } from '../check-design'
import { designChecks } from '../checks'
import { bandContrast } from '../components'
import { contrastRatio } from '../contrast'
import {
  applyLookVariant,
  currentVariant,
  lookVariants,
  TREATMENT_PATHS,
  treatmentOf,
  type LookVariant,
} from '../look-variants'
import { applyPreset, DESIGN_PRESETS } from '../presets'
import { resolveDesign } from '../resolve'
import { defaultDesign, type PortalDesign } from '../schema'
import { readStoredDesign } from '../stored-design'

const FX = join(import.meta.dirname, 'fixtures')

/** A design as a brand match leaves it: its own colours, fonts, logo, words, menu and exact values. */
function matchedBrand(): PortalDesign {
  const doc = defaultDesign()
  doc.mode = 'auto'
  doc.brand.light = {
    accent: '#24543f',
    background: '#f5efe3',
    ink: '#1e2a24',
    support: '#c9733a',
  }
  doc.brand.dark = { background: '#10140f' }
  doc.brand.fonts = {
    heading: { kind: 'bundled', id: 'fraunces' },
    body: { kind: 'bundled', id: 'inter' },
    headingWeight: 500,
    scale: 'display',
  }
  doc.brand.logo.name = 'Harbor & Pine'
  doc.pages.home.headline = {
    title: { en: 'Help shape what we build' },
    subtitle: { en: 'Share feedback and vote on posts.' },
  }
  doc.layout.postCardHides = ['tags']
  doc.tune = {
    headline: { size: 56, weight: 500, colour: 'ink' },
    button: { radius: 6, fill: 'accent', height: 44 },
    card: { radius: 10, border: 1 },
    link: { colour: '#24543f' },
  }
  return doc
}

/** The same brand with its hero already filled with the brand colour, as Vivid would draw it. */
function filledBrand(): PortalDesign {
  const doc = matchedBrand()
  doc.layout.hero = 'brand'
  doc.layout.headerOnHero = false
  return doc
}

const fixtures = readdirSync(FX)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file): [string, PortalDesign] => {
    const doc = readStoredDesign(JSON.parse(readFileSync(join(FX, file), 'utf8')))?.design
    if (!doc) throw new Error(`${file} does not read`)
    // Both modes, so dark mode is checked too.
    return [file, { ...doc, mode: 'auto' }]
  })

const presets = DESIGN_PRESETS.map((preset): [string, PortalDesign] => [
  `preset ${preset.id}`,
  { ...applyPreset(defaultDesign(), preset), mode: 'auto' },
])

const BASES: Array<[string, PortalDesign]> = [
  ['matched brand', matchedBrand()],
  ['brand-filled hero', filledBrand()],
  ...presets,
  ...fixtures,
]

const byId = (variants: LookVariant[], id: string) => variants.find((v) => v.id === id)!.design

/** The design with every treatment field removed: what a look must never change. */
function untreated(doc: PortalDesign): unknown {
  const copy = applyLookVariant(doc, { id: 'matched', design: { layout: {}, shape: {} } as never })
  // Removing a required section's treatment leaves it partial; compare what is left.
  return JSON.parse(JSON.stringify(copy))
}

/** How many visible treatments two designs differ in: hero, header, headline, corners, room, cards, votes. */
function visiblyApart(a: PortalDesign, b: PortalDesign): number {
  const x = treatmentOf(a)
  const y = treatmentOf(b)
  const differ = (...paths: string[]) =>
    paths.some((p) => JSON.stringify(x[p]) !== JSON.stringify(y[p]))
  const size = (t: Record<string, unknown>) =>
    (t['style.headline.base.size'] ?? t['tune.headline.size']) as number | undefined
  const sa = size(x)
  const sb = size(y)
  return [
    differ('layout.hero', 'layout.heroShape', 'layout.heroColour'),
    differ('layout.headerOnHero', 'layout.heroHeight'),
    sa === undefined || sb === undefined ? sa !== sb : Math.abs(sa - sb) / Math.max(sa, sb) >= 0.08,
    differ('tune.headline.weight'),
    differ('tune.button.radius', 'tune.card.radius'),
    differ('layout.density'),
    differ('tune.card.shadow'),
    differ('style.vote'),
  ].filter(Boolean).length
}

describe('lookVariants', () => {
  it('offers Matched, Soft and Vivid, Matched being the design unchanged', () => {
    const base = matchedBrand()
    const variants = lookVariants(base)
    expect(variants.map((v) => v.id)).toEqual(['matched', 'soft', 'vivid'])
    expect(variants[0]!.design).toEqual(base)
    expect(variants[0]!.design).not.toBe(base)
  })

  it('draws Soft as a pale tint panel with room, round corners and a lighter, smaller headline', () => {
    const soft = byId(lookVariants(matchedBrand()), 'soft')
    expect(soft.layout).toMatchObject({ hero: 'tint', heroShape: 'inset', density: 'spacious' })
    expect(soft.shape).toMatchObject({ corners: 'pill', buttons: 'pill' })
    expect(soft.tune?.button?.radius).toBe(999)
    expect(soft.tune?.card?.radius).toBeGreaterThanOrEqual(20)
    expect(soft.tune?.card?.shadow).toBe('floating')
    expect(soft.tune?.headline?.size).toBeLessThan(56)
    expect(soft.tune?.headline?.weight).toBeLessThan(500)
    expect(soft.style?.vote?.base).toMatchObject({ background: 'raised', borderWidth: 0 })
  })

  it('draws Vivid with the brand colour filling the hero, a bigger, heavier headline and small corners', () => {
    const vivid = byId(lookVariants(matchedBrand()), 'vivid')
    expect(vivid.layout.hero).toBe('brand')
    expect(vivid.layout.heroShape).toBeUndefined()
    expect(vivid.layout.heroColour).toBeUndefined()
    // The deep green carries light text, so the header shares it.
    expect(vivid.layout.headerOnHero).toBe(true)
    expect(vivid.tune?.headline?.size).toBeGreaterThan(56)
    expect(vivid.tune?.headline?.weight).toBeGreaterThanOrEqual(700)
    expect(vivid.tune?.button?.radius).toBeLessThanOrEqual(4)
    expect(vivid.tune?.card?.radius).toBeLessThanOrEqual(4)
    expect(vivid.style?.vote?.base).toMatchObject({ background: 'accent', color: 'on-accent' })
  })

  it('keeps a light brand colour’s header off the hero, where dark text would not match it', () => {
    const base = matchedBrand()
    base.brand.light.accent = '#ffd400'
    expect(byId(lookVariants(base), 'vivid').layout.headerOnHero).toBeUndefined()
  })

  it('fills Vivid’s hero with the second colour where the brand colour reads poorly under text', () => {
    const base = matchedBrand()
    // A mid green: neither black nor white text reads clearly on it (APCA under 60); deep green does.
    base.brand.light.accent = '#1db954'
    base.brand.light.support = '#173a2b'
    const vivid = byId(lookVariants(base), 'vivid')
    expect(vivid.layout.heroColour).toBe('support')
    base.brand.light.support = '#7fd39a'
    expect(byId(lookVariants(base), 'vivid').layout.heroColour).toBeUndefined()
  })

  it('tints Soft with a coloured role when the brand colour is grey', () => {
    const base = matchedBrand()
    base.brand.light.accent = '#111111'
    expect(byId(lookVariants(base), 'soft').layout.heroColour).toBe('support')
    delete base.brand.light.support
    expect(byId(lookVariants(base), 'soft').layout.heroColour).toBeUndefined()
  })

  it('takes a headline’s face’s own weights, never a faked one', () => {
    const base = matchedBrand()
    // Oswald has no 300, so Soft's lighter headline is the lightest it has near 300.
    base.brand.fonts.heading = { kind: 'bundled', id: 'oswald' }
    base.tune!.headline!.weight = 400
    const weight = byId(lookVariants(base), 'soft').tune!.headline!.weight!
    expect(weight).toBeLessThan(400)
    expect([200, 300]).toContain(weight)
  })
})

describe.each(BASES)('the looks of %s', (_name, base) => {
  const variants = lookVariants(base)

  it('change only the treatment: colours, fonts, logo, words, pages, menu and post cards stay', () => {
    for (const v of variants) {
      expect(untreated(v.design)).toEqual(untreated(base))
      expect(v.design.brand).toEqual({
        ...base.brand,
        fonts: { ...base.brand.fonts, scale: v.design.brand.fonts.scale },
      })
      expect(v.design.pages).toEqual(base.pages)
      expect(v.design.nav).toEqual(base.nav)
      expect(v.design.layout.postCardHides).toEqual(base.layout.postCardHides)
      for (const group of ['headline', 'subtitle', 'heading', 'link'] as const)
        expect(v.design.tune?.[group]?.['colour' as never]).toEqual(
          base.tune?.[group]?.['colour' as never]
        )
      expect(v.design.tune?.button?.fill).toEqual(base.tune?.button?.fill)
      expect(v.design.tune?.button?.ink).toEqual(base.tune?.button?.ink)
      expect(v.design.styleDark).toEqual(base.styleDark)
    }
  })

  it('are each the base with their treatment, and taking one twice is taking it once', () => {
    for (const v of variants) {
      expect(applyLookVariant(base, v)).toEqual(v.design)
      const once = applyLookVariant(v.design, v)
      expect(applyLookVariant(once, v)).toEqual(once)
      expect(once).toEqual(v.design)
    }
  })

  it('read in light and dark: every hero headline reaches AA and the solver refuses nothing', () => {
    for (const v of variants) {
      const resolved = resolveDesign(v.design)
      expect(resolved.errors, v.id).toEqual([])
      for (const mode of ['light', 'dark'] as const) {
        const vars = resolved[mode]
        expect(vars, `${v.id} ${mode}`).not.toBeNull()
        const band = bandContrast(v.design, vars!, mode)
        if (band)
          expect(
            contrastRatio(band.ink, band.background),
            `${v.id} ${mode} hero`
          ).toBeGreaterThanOrEqual(band.target)
      }
    }
  })

  it('pass the design checks with nothing new against Matched', () => {
    const before = new Set(designChecks(base).map((c) => c.id))
    for (const v of variants) {
      expect(checkDesign(v.design).ok, v.id).toBe(true)
      expect(
        designChecks(v.design)
          .map((c) => c.id)
          .filter((id) => !before.has(id)),
        v.id
      ).toEqual([])
    }
  })

  it('are clearly apart from each other, in three visible treatments or more', () => {
    const [matched, soft, vivid] = variants.map((v) => v.design)
    expect(visiblyApart(matched!, soft!)).toBeGreaterThanOrEqual(3)
    expect(visiblyApart(matched!, vivid!)).toBeGreaterThanOrEqual(3)
    expect(visiblyApart(soft!, vivid!)).toBeGreaterThanOrEqual(3)
  })

  it('are each recognised as themselves, through an edit of words or colours, until the treatment is edited', () => {
    for (const v of variants) {
      expect(currentVariant(v.design, base)).toBe(v.id)
      const edited = structuredClone(v.design)
      edited.brand.light.accent = '#5b21b6'
      edited.nav.items[0] = { ...edited.nav.items[0]!, label: 'Ideas board' } as never
      expect(currentVariant(edited, base)).toBe(v.id)
      const moved = structuredClone(v.design)
      moved.layout.width = moved.layout.width === 'wide' ? 'narrow' : 'wide'
      expect(currentVariant(moved, base)).toBe(v.id)
      const away = structuredClone(v.design)
      away.tune = { ...away.tune, headline: { ...away.tune?.headline, size: 141 } }
      expect(currentVariant(away, base)).toBeNull()
    }
  })
})

describe('a look over a design edited since', () => {
  it('keeps the edits and takes only the look’s treatment', () => {
    const base = matchedBrand()
    const vivid = lookVariants(base).find((v) => v.id === 'vivid')!
    const edited = structuredClone(base)
    edited.brand.light.accent = '#7a1f2b'
    edited.brand.fonts.heading = { kind: 'bundled', id: 'lora' }
    edited.pages.home.headline!.title = { en: 'Tell us what to fix' }
    edited.layout.postCardHides = ['meta']
    edited.layout.width = 'wide'
    const next = applyLookVariant(edited, vivid)
    expect(next.brand.light.accent).toBe('#7a1f2b')
    expect(next.brand.fonts.heading).toEqual({ kind: 'bundled', id: 'lora' })
    expect(next.pages.home.headline!.title).toEqual({ en: 'Tell us what to fix' })
    expect(next.layout.postCardHides).toEqual(['meta'])
    expect(next.layout.width).toBe('wide')
    expect(next.layout.hero).toBe('brand')
    for (const path of TREATMENT_PATHS)
      expect(treatmentOf(next)[path], path).toEqual(treatmentOf(vivid.design)[path])
    expect(currentVariant(next, base)).toBe('vivid')
  })

  it('removes what the look leaves out, such as Matched’s own art after Soft', () => {
    const base = matchedBrand()
    base.layout.hero = 'brand'
    base.layout.heroArt = 'waves'
    const soft = lookVariants(base).find((v) => v.id === 'soft')!
    expect(applyLookVariant(base, soft).layout.heroArt).toBeUndefined()
    const back = applyLookVariant(soft.design, lookVariants(base)[0]!)
    expect(back.layout.heroArt).toBe('waves')
    expect(back).toEqual(base)
  })
})

describe('Vivid over a hero already filled with the brand colour', () => {
  it('goes further rather than repeat Matched: the header on the hero, a taller hero, a bigger headline', () => {
    const base = filledBrand()
    const vivid = byId(lookVariants(base), 'vivid')
    expect(vivid.layout.headerOnHero).toBe(true)
    expect(vivid.layout.heroHeight).toBe('tall')
    expect(vivid.tune!.headline!.size!).toBeGreaterThanOrEqual(Math.round(56 * 1.25))
  })
})

describe('a vote box given a colour', () => {
  it('colours its count too, which otherwise keeps the text colour on the fill', () => {
    const vivid = byId(lookVariants(matchedBrand()), 'vivid')
    const css = resolveDesign(vivid).styleCss ?? ''
    expect(css).toMatch(
      /\[data-qb-part=vote-button\] \[data-testid=vote-count\] \{ color: inherit; \}/
    )
    expect(resolveDesign(matchedBrand()).styleCss ?? '').not.toContain('vote-count')
  })
})
