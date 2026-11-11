/**
 * The hero is a block of the registry: never added or removed, its settings
 * the site's, each change checked before it reaches the design, and each one
 * stored under the design's older band fields so stored designs keep working.
 */
import { describe, expect, it } from 'vitest'
import { aiKeysOf, applySetting, blockOf, blocksByJob, summaryOf } from '../blocks'
import { scopeFields } from '../apply-changes'
import { HERO_AI_PATHS, heroOf, heroSettingShown, writeHero, type HeroKey } from '../hero'
import { newBlock } from '../home'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'

/** One setting changed through the registry and written into a copy of the design. */
function set(design: PortalDesign, key: HeroKey, value: unknown): PortalDesign {
  const result = applySetting(heroOf(design), key, value)
  if (!result.ok) throw new Error(result.refusal)
  const next = structuredClone(design)
  writeHero(next, result.block as ReturnType<typeof heroOf>, key)
  return next
}

describe('the hero in the registry', () => {
  it('is a block named Hero that is never added', () => {
    const def = blockOf('hero')
    expect(def).toMatchObject({ name: 'Hero', job: null, addable: false, repeat: 'once' })
    expect(def!.note).toBe('On every page')
    const offered = blocksByJob().flatMap((group) => group.blocks.map((block) => block.type))
    expect(offered).not.toContain('hero')
  })

  it('holds every hero setting, in the panel’s order', () => {
    expect(blockOf('hero')!.fields.map((field) => field.key)).toEqual([
      'look',
      'image',
      'imagePlace',
      'imagePhone',
      'art',
      'glow',
      'blend',
      'fadeFrom',
      'colour',
      'height',
      'align',
      'shape',
      'headerBlend',
      'titles',
      'mainAction',
      'composerWidth',
      'buttonTo',
      'secondButton',
      'action',
    ])
  })

  it('offers the curated looks as its Look', () => {
    const look = blockOf('hero')!.fields[0]!
    expect(look.kind).toBe('choice')
    if (look.kind !== 'choice') return
    expect(look.options.map(([, name]) => name)).toEqual(
      expect.arrayContaining(['Plain', 'Brand colour', 'Blend'])
    )
  })

  it('lets the AI change the design fields its settings store, and only those of the hero', () => {
    expect(aiKeysOf('hero')).toEqual(HERO_AI_PATHS)
    for (const path of [
      'layout.hero',
      'brand.heroImage',
      'layout.heroArt',
      'layout.heroColour',
      'layout.heroHeight',
      'layout.heroAlign',
      'layout.heroShape',
      'layout.headerOnHero',
      'layout.pageTitles',
      'layout.imagePlace',
      'layout.imagePhone',
      'pages.home.composer',
      'pages.home.mainAction',
      'pages.home.composerWidth',
      'pages.home.button',
      'shape.action',
    ])
      expect(aiKeysOf('hero')).toContain(path)
    // A request about the hero can reach each of them.
    const reach = scopeFields('band')
    for (const path of HERO_AI_PATHS)
      expect(reach.some((field) => path === field || path.startsWith(`${field}.`))).toBe(true)
  })
})

describe('heroOf', () => {
  it('reads the hero as it draws', () => {
    expect(heroOf(defaultDesign())).toEqual({
      type: 'hero',
      look: 'plain',
      image: null,
      imagePlace: 'side',
      imagePhone: 'show',
      art: 'none',
      glow: 'none',
      blend: 'linear',
      fadeFrom: 'top',
      colour: 'accent',
      height: 'roomy',
      align: 'left',
      shape: 'full',
      headerBlend: false,
      titles: 'plain',
      mainAction: 'none',
      composerWidth: 'full',
      buttonTo: 'composer',
      secondButton: false,
      action: 'buttons',
    })
  })

  it('reads a look no curated one makes as Custom', () => {
    const design = defaultDesign()
    design.layout.hero = 'brand'
    design.layout.heroArt = 'petals'
    expect(heroOf(design).look).toBe('custom')
  })
})

describe('changing the hero', () => {
  it('takes a look, writing every field it covers', () => {
    const design = set(defaultDesign(), 'look', 'brand-waves')
    expect(design.layout).toMatchObject({ hero: 'brand', heroArt: 'waves' })
    expect(heroOf(design).look).toBe('brand-waves')
    expect(portalDesign.safeParse(design).success).toBe(true)
  })

  it('keeps its height when a look is taken', () => {
    let design = set(defaultDesign(), 'height', 'tall')
    design = set(design, 'look', 'tint')
    expect(design.layout.heroHeight).toBe('tall')
    expect(heroOf(design).look).toBe('tint')
  })

  it('refuses a look it does not offer, Custom included', () => {
    const hero = heroOf(defaultDesign())
    expect(applySetting(hero, 'look', 'neon')).toMatchObject({ ok: false })
    expect(applySetting(hero, 'look', 'custom')).toMatchObject({ ok: false })
    expect(applySetting(hero, 'height', 'huge')).toEqual({
      ok: false,
      refusal: 'Height can be Short, Roomy or Tall',
    })
    expect(applySetting(hero, 'nope', 1)).toEqual({
      ok: false,
      refusal: 'Hero has no setting called nope',
    })
  })

  it('takes an image with its description, and lets it go', () => {
    let design = set(defaultDesign(), 'image', { key: 'band/team.jpg', alt: 'Our team' })
    expect(design.brand.heroImage).toEqual({ key: 'band/team.jpg', alt: 'Our team' })
    design.layout.imagePoint = { x: 20, y: 30 }
    // The same image described again keeps its crop.
    design = set(design, 'image', { key: 'band/team.jpg', decorative: true })
    expect(design.layout.imagePoint).toEqual({ x: 20, y: 30 })
    design = set(design, 'image', null)
    expect(design.brand.heroImage).toBeUndefined()
    expect(design.layout.imagePoint).toBeUndefined()
    expect(applySetting(heroOf(design), 'image', { key: 'x', alt: 'a'.repeat(201) })).toMatchObject(
      { ok: false }
    )
  })

  it('leaves a value back at its default out of the design', () => {
    let design = set(defaultDesign(), 'shape', 'inset')
    expect(design.layout.heroShape).toBe('inset')
    design = set(design, 'shape', 'full')
    expect('heroShape' in design.layout).toBe(false)
    design = set(design, 'headerBlend', true)
    expect(design.layout.headerOnHero).toBe(true)
    design = set(design, 'headerBlend', false)
    expect('headerOnHero' in design.layout).toBe(false)
    design = set(design, 'titles', 'band')
    expect(design.layout.pageTitles).toBe('band')
    design = set(design, 'action', 'support')
    expect(design.shape.action).toBe('support')
    design = set(design, 'action', 'accent')
    expect(design.shape.action).toBe('accent')
    design = set(design, 'action', 'buttons')
    expect(design.shape.action).toBeUndefined()
  })

  it('puts Home’s composer in the hero, giving a contact block its own row', () => {
    const start = defaultDesign()
    start.pages.home.blocks = [
      { ...newBlock('composer'), id: 'composer01', grid: { x: 0, y: 0, w: 12, h: 1 } },
      { ...newBlock('contact'), id: 'contact001', grid: { x: 0, y: 1, w: 4, h: 1 } },
    ]
    const design = set(start, 'mainAction', 'composer')
    expect(design.pages.home.composer).toBe('band')
    expect(design.pages.home).not.toHaveProperty('mainAction')
    expect(design.pages.home.blocks[1]!.grid).toMatchObject({ x: 0, w: 12 })
    expect(set(design, 'mainAction', 'none').pages.home.composer).toBeUndefined()
  })

  it('puts the help search or a call to action in the hero, the composer on the grid', () => {
    const start = defaultDesign()
    start.pages.home.blocks = [{ ...newBlock('composer'), id: 'composer01' }]
    start.pages.home.composer = 'band'
    const search = set(start, 'mainAction', 'search')
    expect(search.pages.home.mainAction).toBe('search')
    expect(search.pages.home).not.toHaveProperty('composer')
    expect(heroOf(search).mainAction).toBe('search')
    const button = set(search, 'mainAction', 'button')
    expect(heroOf(button).mainAction).toBe('button')
    expect(portalDesign.safeParse(button).success).toBe(true)
    expect(() => set(start, 'mainAction', 'banner')).toThrow()
  })

  it('sends the call to action to the roadmap, with a quiet second one, leaving defaults out', () => {
    const start = defaultDesign()
    start.pages.home.mainAction = 'button'
    const roadmap = set(start, 'buttonTo', 'roadmap')
    expect(roadmap.pages.home.button).toEqual({ to: 'roadmap' })
    expect(heroOf(roadmap).buttonTo).toBe('roadmap')
    const second = set(roadmap, 'secondButton', true)
    expect(second.pages.home.button).toEqual({ to: 'roadmap', second: true })
    expect(heroOf(second).secondButton).toBe(true)
    const back = set(set(second, 'buttonTo', 'composer'), 'secondButton', false)
    expect(back.pages.home).not.toHaveProperty('button')
  })

  it('keeps the call to action’s words when where it goes changes', () => {
    const start = defaultDesign()
    start.pages.home.mainAction = 'button'
    start.pages.home.button = { label: { en: 'Tell us' } }
    expect(set(start, 'buttonTo', 'roadmap').pages.home.button).toEqual({
      to: 'roadmap',
      label: { en: 'Tell us' },
    })
  })

  it('sizes the composer in the hero by step, leaving out the step it draws at untouched', () => {
    const start = defaultDesign()
    start.pages.home.blocks = [{ ...newBlock('composer'), id: 'composer01' }]
    start.pages.home.composer = 'band'
    const narrow = set(start, 'composerWidth', 'narrow')
    expect(narrow.pages.home.composerWidth).toBe('narrow')
    expect(heroOf(narrow).composerWidth).toBe('narrow')
    expect(portalDesign.safeParse(narrow).success).toBe(true)
    expect(set(narrow, 'composerWidth', 'full').pages.home).not.toHaveProperty('composerWidth')
    expect(() => set(start, 'composerWidth', 'huge')).toThrow()
  })

  it('sums itself up by its look', () => {
    expect(summaryOf(heroOf(defaultDesign()))).toBe('Plain')
    const design = set(defaultDesign(), 'look', 'brand')
    design.brand.heroImage = { key: 'a.png' }
    expect(summaryOf(heroOf(design))).toBe('Brand colour · with an image')
  })
})

describe('the hero’s panel shows', () => {
  it('image settings once there is an image, and art without one', () => {
    const design = set(defaultDesign(), 'look', 'brand')
    expect(heroSettingShown('imagePlace', design, 'home')).toBe(false)
    expect(heroSettingShown('art', design, 'home')).toBe(true)
    design.brand.heroImage = { key: 'a.png' }
    expect(heroSettingShown('imagePlace', design, 'home')).toBe(true)
    expect(heroSettingShown('imagePhone', design, 'home')).toBe(true)
    expect(heroSettingShown('art', design, 'home')).toBe(false)
  })

  it('a glow on a brand or second-colour hero without an image, and writes it as set', () => {
    let design = set(defaultDesign(), 'look', 'brand')
    expect(heroSettingShown('glow', design, 'home')).toBe(true)
    design = set(design, 'glow', 'bottom')
    expect(design.layout.heroGlow).toBe('bottom')
    expect(heroOf(design).look).toBe('brand')
    expect(portalDesign.safeParse(design).success).toBe(true)
    // Back to none, the field is left out, as an untouched design has it.
    expect(set(design, 'glow', 'none').layout).not.toHaveProperty('heroGlow')
    expect(heroSettingShown('glow', set(defaultDesign(), 'look', 'tint'), 'home')).toBe(false)
    design.brand.heroImage = { key: 'a.png' }
    expect(heroSettingShown('glow', design, 'home')).toBe(false)
  })

  it('a height on Home only, and not for a plain hero, whose room under the header is fixed', () => {
    const coloured = set(defaultDesign(), 'look', 'brand')
    expect(heroSettingShown('height', coloured, 'home')).toBe(true)
    expect(heroSettingShown('height', coloured, 'feedback')).toBe(false)
    expect(heroSettingShown('height', set(coloured, 'look', 'plain'), 'home')).toBe(false)
  })

  it('the main action on Home only', () => {
    const design = defaultDesign()
    expect(heroSettingShown('mainAction', design, 'home')).toBe(true)
    expect(heroSettingShown('mainAction', design, 'feedback')).toBe(false)
  })

  it('where the call to action goes, and its second, only with a call to action', () => {
    const design = defaultDesign()
    expect(heroSettingShown('buttonTo', design, 'home')).toBe(false)
    expect(heroSettingShown('secondButton', design, 'home')).toBe(false)
    design.pages.home.mainAction = 'button'
    expect(heroSettingShown('buttonTo', design, 'home')).toBe(true)
    expect(heroSettingShown('secondButton', design, 'home')).toBe(true)
    expect(heroSettingShown('buttonTo', design, 'feedback')).toBe(false)
  })

  it('the composer’s width only with the composer in the hero', () => {
    const design = defaultDesign()
    design.pages.home.blocks = [{ ...newBlock('composer'), id: 'composer01' }]
    expect(heroSettingShown('composerWidth', design, 'home')).toBe(false)
    design.pages.home.composer = 'band'
    expect(heroSettingShown('composerWidth', design, 'home')).toBe(true)
    expect(heroSettingShown('composerWidth', design, 'feedback')).toBe(false)
    design.pages.home.mainAction = 'search'
    expect(heroSettingShown('composerWidth', design, 'home')).toBe(false)
  })

  it('the colour and call to action once the brand has a second colour', () => {
    const design = set(defaultDesign(), 'look', 'brand')
    expect(heroSettingShown('colour', design, 'home')).toBe(false)
    expect(heroSettingShown('action', design, 'home')).toBe(false)
    design.brand.light.support = '#0ea5e9'
    expect(heroSettingShown('colour', design, 'home')).toBe(true)
    expect(heroSettingShown('action', design, 'home')).toBe(true)
  })

  it('the call to action once buttons are in the text colour, so the brand colour is a choice', () => {
    const design = set(defaultDesign(), 'look', 'brand')
    design.shape.fill = 'ink'
    expect(heroSettingShown('action', design, 'home')).toBe(true)
  })
})
