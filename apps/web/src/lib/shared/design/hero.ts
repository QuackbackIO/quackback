/**
 * The hero: the area at the top of each page with its headline, subtitle and,
 * on Home, often the composer, an image or art. It is one block on every page
 * that has one, picked like any other, and its settings live in its own panel.
 *
 * The design document stores the hero's settings as layout.hero,
 * layout.heroShape, brand.heroImage and so on; up to format 2 they were named
 * for a "band" (migrations.ts). What visitors' pages and workspace CSS can
 * name, the `--qb-band-*` properties and `data-qb-*band*` attributes, keep
 * the older word.
 *
 * A hero's settings are the site's: its look is the same on every page. The
 * composer's place is Home's alone, and the words are each page's own, edited
 * on the page itself.
 */
import { z } from 'zod'
import { designRoles } from './colour-roles'
import { composerWidthOf, writeComposerWidth } from './composer-width'
import { BAND_LOOKS, bandLookOf, takeBandLook } from './curated'
import { buttonToOf, composerInHero, mainActionOf, writeMainAction } from './main-action'
import { DESIGN_OPTIONS } from './options'
import type { DesignerPage } from './outline'
import {
  assetKey,
  imageShadeSchema,
  imageVariantSchema,
  screenshotSourceSchema,
  type PortalDesign,
} from './schema'
import { DESIGN_DEFAULTS, layoutValue, shapeValue } from './defaults'

/** The look a hero has when no curated look makes it, such as one Quackback AI drew. */
export const CUSTOM_LOOK = 'custom'

/** The hero's settings as one block, each as it draws (a value left out reads as its default). */
export interface HeroBlock {
  type: 'hero'
  /** A curated look's id, or `custom`. */
  look: string
  image: NonNullable<PortalDesign['brand']['heroImage']> | null
  imagePlace: (typeof DESIGN_OPTIONS.imagePlace)[number]
  imagePhone: (typeof DESIGN_OPTIONS.imagePhone)[number]
  art: (typeof DESIGN_OPTIONS.heroArt)[number]
  glow: (typeof DESIGN_OPTIONS.heroGlow)[number]
  blend: (typeof DESIGN_OPTIONS.blend)[number]
  fadeFrom: (typeof DESIGN_OPTIONS.fadeFrom)[number]
  colour: (typeof DESIGN_OPTIONS.colourRole)[number]
  height: (typeof DESIGN_OPTIONS.heroHeight)[number]
  align: (typeof DESIGN_OPTIONS.heroAlign)[number]
  shape: (typeof DESIGN_OPTIONS.heroShape)[number]
  headerBlend: boolean
  titles: (typeof DESIGN_OPTIONS.pageTitles)[number]
  /** Home's one main action under the headline (main-action.ts). */
  mainAction: (typeof DESIGN_OPTIONS.mainAction)[number]
  /** How wide the composer is in the hero, as it draws. */
  composerWidth: (typeof DESIGN_OPTIONS.composerWidth)[number]
  /** Where Home's call to action goes. */
  buttonTo: (typeof DESIGN_OPTIONS.heroButtonTo)[number]
  /** Whether a quiet second button sits beside it, going to the other place. */
  secondButton: boolean
  action: (typeof DESIGN_OPTIONS.action)[number]
}
export type HeroKey = Exclude<keyof HeroBlock, 'type'>

const image = z
  .object({
    key: assetKey,
    alt: z.string().trim().max(200).optional(),
    decorative: z.boolean().optional(),
    screenshot: screenshotSourceSchema.optional(),
    shade: imageShadeSchema.optional(),
    homeOnly: z.boolean().optional(),
    width: z.number().int().min(1).max(8192).optional(),
    variants: z.array(imageVariantSchema).min(1).max(4).optional(),
  })
  .strict()

/** What a hero's settings may be; a look is one of the curated ones, never Custom. */
export const heroSchema = z
  .object({
    type: z.literal('hero'),
    look: z.union([
      z.enum(BAND_LOOKS.map((look) => look.id) as [string, ...string[]]),
      z.literal(CUSTOM_LOOK),
    ]),
    image: image.nullable(),
    imagePlace: z.enum(DESIGN_OPTIONS.imagePlace),
    imagePhone: z.enum(DESIGN_OPTIONS.imagePhone),
    art: z.enum(DESIGN_OPTIONS.heroArt),
    glow: z.enum(DESIGN_OPTIONS.heroGlow),
    blend: z.enum(DESIGN_OPTIONS.blend),
    fadeFrom: z.enum(DESIGN_OPTIONS.fadeFrom),
    colour: z.enum(DESIGN_OPTIONS.colourRole),
    height: z.enum(DESIGN_OPTIONS.heroHeight),
    align: z.enum(DESIGN_OPTIONS.heroAlign),
    shape: z.enum(DESIGN_OPTIONS.heroShape),
    headerBlend: z.boolean(),
    titles: z.enum(DESIGN_OPTIONS.pageTitles),
    mainAction: z.enum(DESIGN_OPTIONS.mainAction),
    composerWidth: z.enum(DESIGN_OPTIONS.composerWidth),
    buttonTo: z.enum(DESIGN_OPTIONS.heroButtonTo),
    secondButton: z.boolean(),
    action: z.enum(DESIGN_OPTIONS.action),
  })
  .strict()

/**
 * The design fields each hero setting stores, as Quackback AI names them. The
 * look writes several at once; the image's crop is part of the image.
 */
export const HERO_PATHS: Record<HeroKey, readonly string[]> = {
  look: ['layout.hero', 'layout.blend', 'layout.heroShape', 'layout.heroArt'],
  image: ['brand.heroImage', 'layout.imageFocus', 'layout.imagePoint'],
  imagePlace: ['layout.imagePlace'],
  imagePhone: ['layout.imagePhone'],
  art: ['layout.heroArt'],
  glow: ['layout.heroGlow', 'layout.heroGlowColour'],
  blend: ['layout.blend'],
  fadeFrom: ['layout.fadeFrom'],
  colour: ['layout.heroColour'],
  height: ['layout.heroHeight'],
  align: ['layout.heroAlign'],
  shape: ['layout.heroShape'],
  headerBlend: ['layout.headerOnHero'],
  titles: ['layout.pageTitles'],
  mainAction: ['pages.home.composer', 'pages.home.mainAction'],
  composerWidth: ['pages.home.composerWidth'],
  buttonTo: ['pages.home.button'],
  secondButton: ['pages.home.button'],
  action: ['shape.action'],
}

/** Every design field the hero's settings reach, once each, in the panel's order. */
export const HERO_AI_PATHS: readonly string[] = [...new Set(Object.values(HERO_PATHS).flat())]

/** The hero's settings as a design draws them. */
export function heroOf(design: PortalDesign): HeroBlock {
  const { layout } = design
  return {
    type: 'hero',
    look: bandLookOf(design) ?? CUSTOM_LOOK,
    image: design.brand.heroImage ?? null,
    imagePlace: layoutValue(layout, 'imagePlace'),
    imagePhone: layoutValue(layout, 'imagePhone'),
    art: layoutValue(layout, 'heroArt'),
    glow: layoutValue(layout, 'heroGlow'),
    blend: layoutValue(layout, 'blend'),
    fadeFrom: layoutValue(layout, 'fadeFrom'),
    colour: layoutValue(layout, 'heroColour'),
    height: layoutValue(layout, 'heroHeight'),
    align: layout.heroAlign ?? (layout.header === 'centered' ? 'centre' : 'left'),
    shape: layoutValue(layout, 'heroShape'),
    headerBlend: layout.headerOnHero === true,
    titles: layoutValue(layout, 'pageTitles'),
    mainAction: mainActionOf(design.pages.home),
    composerWidth: composerWidthOf(design),
    buttonTo: buttonToOf(design.pages.home),
    secondButton: design.pages.home.button?.second === true,
    action: shapeValue(design.shape, 'action'),
  }
}

/** Each layout field a setting stores, and the value it reads as when left out. */
const LAYOUT_FIELDS = {
  imagePlace: ['imagePlace', DESIGN_DEFAULTS.layout.imagePlace],
  imagePhone: ['imagePhone', DESIGN_DEFAULTS.layout.imagePhone],
  art: ['heroArt', DESIGN_DEFAULTS.layout.heroArt],
  glow: ['heroGlow', DESIGN_DEFAULTS.layout.heroGlow],
  blend: ['blend', DESIGN_DEFAULTS.layout.blend],
  fadeFrom: ['fadeFrom', DESIGN_DEFAULTS.layout.fadeFrom],
  colour: ['heroColour', DESIGN_DEFAULTS.layout.heroColour],
  height: ['heroHeight', DESIGN_DEFAULTS.layout.heroHeight],
  shape: ['heroShape', DESIGN_DEFAULTS.layout.heroShape],
  headerBlend: ['headerOnHero', DESIGN_DEFAULTS.layout.headerOnHero],
  titles: ['pageTitles', DESIGN_DEFAULTS.layout.pageTitles],
} as const satisfies Partial<Record<HeroKey, readonly [keyof PortalDesign['layout'], unknown]>>

/**
 * Writes one of the hero's settings into a design. A value back at its
 * default is left out, so the design reads as it did before it was touched.
 * A look writes every field it covers; Custom is never written.
 */
export function writeHero(draft: PortalDesign, hero: HeroBlock, key: HeroKey): void {
  const layout = draft.layout as Record<string, unknown>
  switch (key) {
    case 'look':
      if (hero.look !== CUSTOM_LOOK) takeBandLook(draft, hero.look)
      return
    case 'image': {
      const was = draft.brand.heroImage?.key
      if (hero.image) draft.brand.heroImage = { ...hero.image }
      else delete draft.brand.heroImage
      // A new image starts from its centre.
      if (hero.image?.key !== was) {
        delete draft.layout.imagePoint
        delete draft.layout.imageFocus
      }
      return
    }
    case 'align':
      draft.layout.heroAlign = hero.align
      return
    case 'action':
      if (hero.action === 'buttons') delete draft.shape.action
      else draft.shape.action = hero.action
      return
    case 'mainAction':
      writeMainAction(draft, hero.mainAction)
      return
    case 'buttonTo':
    case 'secondButton': {
      const { to: _to, second: _second, ...words } = draft.pages.home.button ?? {}
      const button = {
        ...(hero.buttonTo !== 'composer' ? { to: hero.buttonTo } : {}),
        ...(hero.secondButton ? { second: true } : {}),
        ...words,
      }
      if (Object.keys(button).length) draft.pages.home.button = button
      else delete draft.pages.home.button
      return
    }
    case 'composerWidth':
      writeComposerWidth(draft, hero.composerWidth)
      return
    default: {
      const [field, fallback] = LAYOUT_FIELDS[key]
      if (hero[key] === fallback) delete layout[field]
      else layout[field] = hero[key]
    }
  }
}

/**
 * Whether the hero's panel shows a setting, given the hero as it is and the
 * page shown: image settings once there is an image, art without one, the
 * main action on Home, the composer's width with the composer in it, where
 * a call to action goes with one, the colour once the brand has more than
 * one and the look draws in it.
 */
export function heroSettingShown(key: HeroKey, design: PortalDesign, page: DesignerPage): boolean {
  const { hero: band } = design.layout
  const hasImage = !!design.brand.heroImage
  switch (key) {
    case 'imagePlace':
    case 'imagePhone':
      return hasImage
    case 'art':
      return !hasImage && band !== 'none'
    case 'glow':
      return !hasImage && (band === 'brand' || band === 'support')
    case 'blend':
      return band === 'blend'
    case 'fadeFrom':
      return band === 'fade'
    case 'colour':
      return designRoles(design).length > 1 && ['brand', 'tint', 'fade', 'blend'].includes(band)
    case 'headerBlend':
      return band !== 'none'
    case 'mainAction':
    case 'height':
      // The list pages follow Home's look at a compact height of their own.
      return page === 'home'
    case 'composerWidth':
      return (
        page === 'home' &&
        composerInHero(design.pages.home) &&
        design.pages.home.blocks.some((b) => b.type === 'composer')
      )
    case 'buttonTo':
    case 'secondButton':
      return page === 'home' && mainActionOf(design.pages.home) === 'button'
    case 'action':
      // A choice once the brand has a second colour, or buttons are not in the brand colour.
      return (
        !!design.brand.light.support || design.shape.fill === 'ink' || !!design.tune?.button?.fill
      )
    default:
      return true
  }
}
