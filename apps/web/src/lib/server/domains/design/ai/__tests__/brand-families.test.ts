/**
 * The decision families' prompts and the rules after them: each family's
 * few-shot examples are valid answers to its schema and name every option
 * the prompt offers; the hero's choice maps to fields with the measured
 * colour deciding which colour a solid hero takes; conflicting changes are
 * settled by rule.
 */
import { describe, expect, it } from 'vitest'
import {
  HERO_ART,
  HERO_EXAMPLES,
  HERO_LOOKS,
  HERO_SHAPES,
  heroPrompt,
  heroSchema,
  type HeroEvidence,
} from '../hero-family'
import { ruleHero, type HeroDecision } from '../hero-rules'
import { HOME_ARRANGEMENTS, WORDS_EXAMPLES, wordsPrompt, wordsSchema } from '../words-family'
import { heroChanges, reconcile, faceIds, wordsChanges } from '../brand-decide'
import { heroFallbacks, readableHero } from '../hero-fallbacks'
import { applyDesignChanges } from '@/lib/shared/design/apply-changes'
import { defaultDesign } from '@/lib/shared/design/schema'
import { homeGridItems } from '@/lib/shared/design/home'
import { settle } from '@/lib/shared/design/home-grid'
import type { HeroLayout } from '../hero-geometry'

const EVIDENCE: HeroEvidence = {
  behind: 'solid_colour',
  behindWords: 'lime behind the words',
  measured: 'solid',
  measuredColour: '#9fe870',
  measuredRole: 'support',
  brandColour: '#163300',
  secondColour: '#9fe870',
  page: '#ffffff',
  header: '#9fe870',
  intensity: 'bold',
  monochrome: false,
  roleSurface: null,
  secondField: false,
  heroInset: false,
}

const CENTRED: HeroLayout = {
  align: 'centre',
  height: 'roomy',
  picture: null,
  why: { align: 'the words share a centre', height: 'room around the words' },
}
const UNSEEN: HeroLayout = { align: null, height: null, picture: null, why: {} }

const values = (changes: Array<{ path: string; value: unknown }>) =>
  Object.fromEntries(changes.map((c) => [c.path, c.value]))

describe('hero family', () => {
  it('has examples that are valid answers', () => {
    for (const example of HERO_EXAMPLES)
      expect(heroSchema.parse(example.answer)).toEqual(example.answer)
  })

  it('offers every look, shape and piece of art by what you would see', () => {
    const prompt = heroPrompt(EVIDENCE, true)
    for (const option of [...HERO_LOOKS, ...HERO_SHAPES, ...HERO_ART].filter(
      (o) => o !== 'not_visible'
    ))
      expect(prompt).toContain(option)
    expect(prompt).toContain('not_visible')
    expect(prompt).toContain('A portal is the brand’s product surface'.replace('’', "'"))
    expect(prompt).toContain('#9fe870')
  })

  it('draws a solid hero in the colour measured behind the headline, with the header on it', () => {
    const out = values(
      heroChanges({ hero: ruleHero(EVIDENCE)!, layout: CENTRED, hasBandImage: false })
    )
    expect(out).toMatchObject({
      'layout.hero': 'support',
      'layout.heroShape': 'full',
      'layout.headerOnHero': true,
      'layout.heroAlign': 'centre',
      'layout.heroHeight': 'roomy',
    })
    expect(out['layout.imagePlace']).toBeUndefined()
  })

  it('places the picture where the site’s sits, measured, over the model’s reading', () => {
    const hero = { ...ruleHero(EVIDENCE)!, picture: 'cover' as const }
    const layout = { ...UNSEEN, picture: 'side' as const, why: { picture: 'beside the words' } }
    expect(values(heroChanges({ hero, layout, hasBandImage: true }))['layout.imagePlace']).toBe(
      'side'
    )
  })

  it('places a picture only for a coloured hero with a band image', () => {
    const hero: HeroDecision = {
      band: 'brand',
      blend: null,
      colour: null,
      shape: 'panel',
      glow: null,
      glowFill: null,
      art: 'none',
      headerOnHero: false,
      picture: 'side',
      fill: null,
      by: 'rule',
      why: 'a photo hero',
    }
    const withImage = values(heroChanges({ hero, layout: UNSEEN, hasBandImage: true }))
    expect(withImage).toMatchObject({ 'layout.heroShape': 'panel', 'layout.imagePlace': 'side' })
    expect(
      values(heroChanges({ hero, layout: UNSEEN, hasBandImage: false }))['layout.imagePlace']
    ).toBeUndefined()
    const plain = values(
      heroChanges({
        hero: { ...hero, band: 'none', art: 'hills' },
        layout: UNSEEN,
        hasBandImage: true,
      })
    )
    expect(plain).toMatchObject({
      'layout.hero': 'none',
      'layout.heroArt': 'none',
      'layout.headerOnHero': false,
    })
    expect(plain['layout.heroShape']).toBeUndefined()
    expect(plain['layout.imagePlace']).toBeUndefined()
  })

  it('keeps a monochrome site’s hero plain unless a coloured one was measured', () => {
    const out = values(
      heroChanges({
        hero: ruleHero({ ...EVIDENCE, measured: 'plain', behind: 'gradient', monochrome: true })!,
        layout: UNSEEN,
        hasBandImage: false,
      })
    )
    expect(out['layout.hero']).toBe('none')
  })
})

describe('a hero that can be drawn', () => {
  const PANEL: HeroDecision = {
    band: 'brand',
    blend: null,
    colour: null,
    shape: 'panel',
    glow: null,
    glowFill: null,
    art: 'none',
    headerOnHero: false,
    picture: 'side',
    fill: null,
    by: 'rule',
    why: 'a photo hero',
  }
  const LEFT: HeroLayout = {
    ...UNSEEN,
    align: 'left',
    why: { align: 'the headline starts at the left' },
  }

  it('centres a panel whose picture the design does not have, so no half of the band is empty', () => {
    const out = values(heroChanges({ hero: PANEL, layout: LEFT, hasBandImage: false }))
    expect(out).toMatchObject({ 'layout.heroShape': 'panel', 'layout.heroAlign': 'centre' })
    // With the picture, the words keep the site's side.
    expect(values(heroChanges({ hero: PANEL, layout: LEFT, hasBandImage: true }))).toMatchObject({
      'layout.heroAlign': 'left',
    })
  })

  it('falls back from a line no text reads across to a mesh, then a band in one colour', () => {
    const line: HeroDecision = {
      ...PANEL,
      band: 'blend',
      blend: 'linear',
      shape: 'full',
      picture: null,
    }
    expect(heroFallbacks(line).map((h) => [h.band, h.blend])).toEqual([
      ['blend', 'mesh'],
      ['brand', null],
      ['support', null],
    ])
    expect(heroFallbacks({ ...line, band: 'none', blend: null })).toEqual([])
  })

  it('keeps the first of the hero and its fallbacks the design draws readably', () => {
    // A deep purple into a pale pink: no ink reads across the line, white reads on the purple.
    const base = defaultDesign()
    const colours = [
      { path: 'brand.light.accent', value: '#803cd1' },
      { path: 'brand.light.support', value: '#fedbff' },
    ]
    const line: HeroDecision = {
      ...PANEL,
      band: 'blend',
      blend: 'linear',
      shape: 'full',
      picture: null,
    }
    const drawn = readableHero(line, (hero) =>
      applyDesignChanges(
        base,
        [...colours, ...heroChanges({ hero, layout: UNSEEN, hasBandImage: false })].map((c) => ({
          path: c.path,
          value: c.value,
        })),
        'site'
      )
    )
    // The colours stay a blend, beside the words, before a flat band.
    expect(drawn.hero).toMatchObject({ band: 'blend', blend: 'mesh' })
    expect(drawn.result.design.layout.hero).toBe('blend')
    expect(drawn.result.refused).toEqual([])
  })

  it('draws a band in a measured colour no role holds as an extra colour of the design', () => {
    const dark: HeroDecision = { ...PANEL, shape: 'full', picture: null, fill: '#0f2f35' }
    expect(
      values(heroChanges({ hero: dark, layout: UNSEEN, hasBandImage: false, extras: ['#39a7a4'] }))
    ).toMatchObject({
      'brand.light.extra': ['#39a7a4', '#0f2f35'],
      'layout.heroColour': 'extra2',
    })
    expect(values(heroChanges({ hero: dark, layout: UNSEEN, hasBandImage: false }))).toMatchObject({
      'brand.light.extra': ['#0f2f35'],
      'layout.heroColour': 'extra1',
    })
    // With two logo colours already, the band's takes the second place.
    expect(
      values(
        heroChanges({
          hero: dark,
          layout: UNSEEN,
          hasBandImage: false,
          extras: ['#111111', '#222222'],
        })
      )
    ).toMatchObject({ 'brand.light.extra': ['#111111', '#0f2f35'], 'layout.heroColour': 'extra2' })
    // Without one, a colour left from a design before goes.
    expect(
      values(heroChanges({ hero: PANEL, layout: UNSEEN, hasBandImage: false }))['layout.heroColour']
    ).toBeNull()
  })

  it('lights a band with its measured glow, in a colour of the design’s that matches or an extra one', () => {
    const lit: HeroDecision = {
      ...PANEL,
      shape: 'inset',
      picture: null,
      glow: 'bottom',
      glowFill: '#fbde9a',
    }
    const run = (extras?: string[], hero = lit) =>
      values(heroChanges({ hero, layout: UNSEEN, hasBandImage: false, extras }))
    // A colour of the design's close to the glow's draws it.
    expect(run(['#fbdc9c'])).toMatchObject({
      'layout.heroGlow': 'bottom',
      'layout.heroGlowColour': 'extra1',
      'layout.heroShape': 'inset',
    })
    // Else the glow's colour joins the extra colours, after the logo's.
    expect(run(['#fc9912'])).toMatchObject({
      'brand.light.extra': ['#fc9912', '#fbde9a'],
      'layout.heroGlowColour': 'extra2',
    })
    // With both places taken, the glow is a light of the band's own colour.
    expect(run(['#111111', '#222222'])).toMatchObject({ 'layout.heroGlowColour': null })
    expect(run(['#111111', '#222222'])).not.toHaveProperty('brand.light.extra')
    // A band in a measured colour keeps its place; the glow takes the one after.
    expect(run(['#fc9912'], { ...lit, fill: '#0f2f35' })).toMatchObject({
      'brand.light.extra': ['#fc9912', '#0f2f35'],
      'layout.heroColour': 'extra2',
      'layout.heroGlowColour': null,
    })
    // No glow measured: one left from a design before goes.
    expect(run(['#fc9912'], PANEL)).toMatchObject({
      'layout.heroGlow': null,
      'layout.heroGlowColour': null,
    })
  })

  it('draws a dark band on a light page in its colour, readably', () => {
    const base = defaultDesign()
    const dark: HeroDecision = { ...PANEL, shape: 'full', picture: null, fill: '#0f2f35' }
    const out = applyDesignChanges(
      base,
      [
        { path: 'brand.light.accent', value: '#32e6e0' },
        ...heroChanges({ hero: dark, layout: UNSEEN, hasBandImage: false }),
      ].map((c) => ({ path: c.path, value: c.value })),
      'site'
    )
    expect(out.refused).toEqual([])
    expect(out.design.layout).toMatchObject({ hero: 'brand', heroColour: 'extra1' })
    expect(out.design.brand.light.extra).toEqual(['#0f2f35'])
  })
})

describe('words family', () => {
  it('has examples that are valid answers, in every arrangement it offers', () => {
    for (const example of WORDS_EXAMPLES)
      for (const answer of Object.values(example.answers))
        expect(wordsSchema.parse(answer)).toEqual(answer)
    const prompt = wordsPrompt({
      name: 'Acme',
      headline: 'Ship it',
      subtitle: '',
      button: 'Go',
      seen: [],
      pages: ['feedback'],
      language: null,
    })
    for (const option of HOME_ARRANGEMENTS) expect(prompt).toContain(option)
    expect(prompt).toContain('Their subtitle: none read.')
  })
})

describe('composition', () => {
  const ON = {
    feedback: true,
    roadmap: true,
    changelog: true,
    help: true,
    support: true,
    status: false,
  }
  const answer = (
    home_layout: (typeof HOME_ARRANGEMENTS)[number],
    headline = 'Shape what is next'
  ) => ({
    evidence: 'plain',
    home_layout,
    home_headline: headline,
    home_subtitle: 'Share ideas.',
    feedback_headline: 'Ideas',
    feedback_subtitle: 'Share them.',
    prompt: '',
    submit: '',
  })

  it('writes headlines through the words model: a phrase marked is an accent, plain words have none', () => {
    const plain = values(wordsChanges(answer('portal'), defaultDesign(), ON))
    expect(plain['pages.home.headline.title']).toBe('Shape what is next')
    expect(plain['pages.home.headline.accent']).toBeUndefined()
    const marked = values(
      wordsChanges(
        {
          ...answer('portal', 'Shape what is [next]{accent}'),
          home_subtitle: 'Share [ideas]{lighter}.',
        },
        defaultDesign(),
        ON,
        'fr'
      )
    )
    expect(marked['pages.home.headline.title']).toBe('Shape what is next')
    expect(marked['pages.home.headline.accent']).toEqual({ style: 'colour', text: { fr: 'next' } })
    expect(marked['pages.home.headline.subtitle']).toBe('Share ideas.')
  })

  it('keeps a Home already arranged as it is, whatever arrangement the words chose', () => {
    const helpFirst = values(wordsChanges(answer('help_first'), defaultDesign(), ON))[
      'pages.home.blocks'
    ] as ReturnType<typeof defaultDesign>['pages']['home']['blocks']
    const design = defaultDesign()
    design.pages.home.blocks = helpFirst
    const kept = values(wordsChanges(answer('portal'), design, ON))[
      'pages.home.blocks'
    ] as typeof helpFirst
    const order = (blocks: typeof helpFirst) =>
      [...blocks].sort((a, b) => a.grid.y - b.grid.y || a.grid.x - b.grid.x).map((b) => b.type)
    expect(order(kept)).toEqual(order(helpFirst))
  })

  it('carries headlines written in lower case into the style, so the menu, buttons and headings follow', () => {
    // A studio that sets every word in lower case: the writers wrote its headlines so.
    const lower = {
      ...answer('portal', 'quiet tools, made in small batches'),
      feedback_headline: 'what should the studio make next?',
    }
    const out = applyDesignChanges(
      defaultDesign(),
      wordsChanges(lower, defaultDesign(), ON).map(({ path, value }) => ({ path, value })),
      'site'
    )
    expect(out.refused).toEqual([])
    const style = out.design.style!
    for (const element of ['headline', 'heading', 'navItem', 'button', 'secondary'] as const)
      expect(style[element]?.base?.case, element).toBe('lower')
    // The words keep their punctuation; only their capitals are the style's.
    expect(out.design.pages.feedback.headline?.title.en).toBe('what should the studio make next?')
  })

  it('leaves the case alone where a headline has a capital', () => {
    const mixed = {
      ...answer('portal', 'quiet tools, made in small batches'),
      feedback_headline: 'Ideas',
    }
    const paths = wordsChanges(mixed, defaultDesign(), ON).map((c) => c.path)
    expect(paths.some((p) => p.startsWith('style.'))).toBe(false)
  })

  it('leaves no hole on Home where the composer moves into the band, in every arrangement', () => {
    for (const layout of HOME_ARRANGEMENTS) {
      const out = values(wordsChanges(answer(layout), defaultDesign(), ON))
      expect(out['pages.home.composer']).toBe('band')
      const home = {
        blocks: out['pages.home.blocks'],
        composer: 'band',
      } as ReturnType<typeof defaultDesign>['pages']['home']
      const rows = new Map<number, number>()
      for (const item of settle(homeGridItems(home, ON)))
        rows.set(item.y, (rows.get(item.y) ?? 0) + item.w)
      for (const [y, used] of rows) expect(used, `${layout} row ${y}`).toBe(12)
    }
  })
})

describe('rules after the families', () => {
  it('opens the other pages on the band when Home has a coloured hero, plainly when it has none', () => {
    for (const band of ['brand', 'support', 'blend', 'tint', 'fade'])
      expect(
        values(
          reconcile([
            { path: 'brand.light.support', value: '#ff7a59', why: 'a' },
            { path: 'layout.hero', value: band, why: 'b' },
          ])
        )['layout.pageTitles'],
        band
      ).toBe('band')
    expect(
      values(reconcile([{ path: 'layout.hero', value: 'none', why: 'b' }]))['layout.pageTitles']
    ).toBe('plain')
    expect(
      values(reconcile([{ path: 'brand.light.accent', value: '#000000', why: 'a' }]))
    ).not.toHaveProperty('layout.pageTitles')
  })

  it('a second-colour hero, action or tint needs a second colour', () => {
    const out = reconcile([
      { path: 'layout.hero', value: 'support', why: 'a' },
      { path: 'shape.action', value: 'support', why: 'b' },
      { path: 'layout.tint', value: 'support', why: 'c' },
      { path: 'layout.headerOnHero', value: true, why: 'd' },
    ])
    expect(values(out)).toEqual({
      'layout.hero': 'brand',
      'layout.tint': 'neutral',
      'layout.headerOnHero': true,
      'layout.pageTitles': 'band',
    })
  })

  it('no shared header or art on a plain hero; a later change to a field wins', () => {
    const out = reconcile([
      { path: 'brand.light.support', value: '#ff7a59', why: 'a' },
      { path: 'layout.hero', value: 'brand', why: 'b' },
      { path: 'layout.headerOnHero', value: true, why: 'c' },
      { path: 'layout.heroArt', value: 'waves', why: 'd' },
      { path: 'layout.hero', value: 'none', why: 'e' },
    ])
    expect(out.map((c) => c.path)).toEqual([
      'brand.light.support',
      'layout.headerOnHero',
      'layout.heroArt',
      'layout.hero',
      'layout.pageTitles',
    ])
    expect(values(out)).toMatchObject({ 'layout.headerOnHero': false, 'layout.heroArt': 'none' })
  })

  it('keeps the headline’s settled face and sets body text in Inter, not Inter Tight', () => {
    const m = (id: string, tracking: number) => ({ face: { id }, tracking }) as never
    expect(faceIds({ headline: m('inter', -0.03), body: m('inter-tight', 0) })).toEqual({
      heading: 'inter',
      body: 'inter',
    })
    expect(faceIds({ headline: m('inter-tight', 0), body: null })).toEqual({
      heading: 'inter-tight',
      body: null,
    })
  })
})
