/**
 * Three complete starting designs from a few words, or a logo or
 * screenshot: the brand, the shapes and layout, Home and the composer's
 * wording, so the first look is a whole portal, not a palette.
 * Each look goes through applyDesignChanges as the model's untrusted output,
 * so the schema, the contrast solver and the workspace's pages decide what
 * reaches it.
 */
import type { ContentPart } from '@tanstack/ai'
import { logger } from '@/lib/server/logger'
import { applyDesignChanges, type UntrustedChanges } from '@/lib/shared/design/apply-changes'
import { colourVividness } from '@/lib/shared/design/palette'
import { parseOklch } from '@/lib/shared/theme/expand'
import { hexToOklch } from '@/lib/shared/theme/colors'
import { applyPreset, DESIGN_PRESETS } from '@/lib/shared/design/presets'
import { directionsPrompt, type Look } from './design-looks'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { allowanceRefusal, designAiModel, isStructuredOutputError, paletteText } from './design-ai'
import { readHero, withHero } from './hero-read'
import { writeLooks } from './look-calls'
import { BLOCK_SIZES, BUNDLED_FONT_IDS } from '@/lib/shared/design/options'
import { confirmedBy } from './faithful-look'

const log = logger.child({ module: 'design-directions' })

export { DIRECTIONS_EXAMPLE } from './design-looks'

/** Above this, a page background reads as a colour and drowns the brand colour on it. */
const MAX_PAGE_VIVIDNESS = 0.2
const quietPage = (background: string) =>
  !/^#[0-9a-f]{6}$/i.test(background) || colourVividness(background) <= MAX_PAGE_VIVIDNESS

const oklchOf = (colour: string) =>
  /^#[0-9a-f]{6}$/i.test(colour) ? parseOklch(hexToOklch(colour)) : null

/**
 * The faithful look's accent: the image's own colour of the same hue when
 * the model kept that hue but moved its lightness, as a model does to make
 * text read on it, which the portal does for itself. A different hue is the
 * model's reading of the brand and stays.
 */
export function faithfulAccent(accent: string, input: { palette?: string[] | null }): string {
  const chosen = oklchOf(accent)
  if (!chosen || chosen.c < 0.04) return accent
  const theirs = input.palette ?? []
  let nearest: { colour: string; gap: number } | null = null
  for (const colour of theirs) {
    const own = oklchOf(colour)
    if (!own || own.c < 0.04) continue
    const turn = Math.abs(own.h - chosen.h) % 360
    const gap = Math.min(turn, 360 - turn)
    if (gap <= 25 && (!nearest || gap < nearest.gap)) nearest = { colour, gap }
  }
  return nearest?.colour ?? accent
}

/** Text cut at a word boundary to fit a field; a long answer is trimmed rather than refused. */
const bundled = (face: string) => (BUNDLED_FONT_IDS as readonly string[]).includes(face)

function fit(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  return cut.slice(0, cut.lastIndexOf(' ') > max / 2 ? cut.lastIndexOf(' ') : max).trim()
}

/** A look as changes to its preset's design, in the order they build on each other. */
function lookChanges(look: Look): Array<{ path: string; value: unknown }> {
  const dark = look.mode === 'dark'
  const page = (light: string, path: string) =>
    light ? [{ path, value: light }] : ([] as Array<{ path: string; value: unknown }>)
  return [
    { path: 'mode', value: look.mode },
    { path: 'brand.light.accent', value: look.accent },
    ...(dark
      ? [
          ...page(look.background, 'brand.dark.background'),
          ...page(look.ink, 'brand.dark.ink'),
          ...page(look.surface, 'brand.dark.surface'),
        ]
      : [
          ...(quietPage(look.background) ? page(look.background, 'brand.light.background') : []),
          ...page(look.ink, 'brand.light.ink'),
          ...page(look.surface, 'brand.light.surface'),
          ...page(look.darkBackground, 'brand.dark.background'),
          ...page(look.darkInk, 'brand.dark.ink'),
        ]),
    // A face the model names that is not bundled is left out: the preset's stays.
    ...(bundled(look.headingFont)
      ? [{ path: 'brand.fonts.heading', value: look.headingFont }]
      : []),
    ...(bundled(look.bodyFont) ? [{ path: 'brand.fonts.body', value: look.bodyFont }] : []),
    ...(bundled(look.displayFont) && look.displayFont !== look.headingFont
      ? [{ path: 'brand.fonts.display', value: look.displayFont }]
      : []),
    { path: 'brand.fonts.headingWeight', value: Number(look.headingWeight) },
    { path: 'shape.corners', value: look.corners },
    { path: 'layout.header', value: look.header },
    { path: 'layout.nav', value: look.nav },
    { path: 'layout.cards', value: look.cards },
    { path: 'layout.density', value: look.density },
    { path: 'layout.width', value: look.width },
    { path: 'pages.feedback.headline.title', value: fit(look.headline, 80) },
    { path: 'pages.feedback.headline.subtitle', value: fit(look.subtitle, 140) },
    // The second colour and the blend's style first: a band is checked with what it blends.
    ...page(look.support, 'brand.light.support'),
    ...(look.hero === 'blend' ? [{ path: 'layout.blend', value: look.blend }] : []),
    { path: 'layout.hero', value: look.hero },
    { path: 'layout.heroAlign', value: look.heroAlign },
    { path: 'layout.heroShape', value: look.heroShape },
    { path: 'layout.headerOnHero', value: look.headerOnHero },
    { path: 'layout.pageTitles', value: look.pageTitles },
    { path: 'brand.fonts.scale', value: look.scale },
    { path: 'brand.fonts.tracking', value: look.tracking },
    { path: 'brand.fonts.headlineCase', value: look.headlineCase },
    { path: 'brand.fonts.labelCase', value: look.labelCase },
    { path: 'shape.buttons', value: look.buttons },
    { path: 'shape.fill', value: look.fill },
    { path: 'shape.action', value: look.action },
    { path: 'layout.tint', value: look.tint },
    { path: 'layout.heroArt', value: look.heroArt },
    { path: 'brand.fonts.headlineColour', value: look.headlineColour },
    // Brand status colours need the logo's colours, which a start does not give.
    { path: 'layout.status', value: look.status === 'brand' ? 'colour' : look.status },
    ...page(fit(look.prompt, 60), 'pages.feedback.copy.prompt'),
    ...page(fit(look.submit, 24), 'pages.feedback.copy.submit'),
    ...accentChanges(look, 'pages.feedback.headline', look.headline),
    ...(['roadmap', 'changelog', 'help', 'support'] as const).flatMap((p, i) => [
      ...page(fit(look.pageWords[i * 2] ?? '', 80), `pages.titles.${p}.title`),
      ...page(fit(look.pageWords[i * 2 + 1] ?? '', 140), `pages.titles.${p}.subtitle`),
    ]),
    ...(look.homeBlocks.length
      ? [
          { path: 'pages.home.blocks', value: homeBlocks(look) },
          ...page(fit(look.homeHeadline, 80), 'pages.home.headline.title'),
          ...page(fit(look.homeSubtitle, 140), 'pages.home.headline.subtitle'),
          ...accentChanges(look, 'pages.home.headline', look.homeHeadline),
          // With a Home headline the composer sits under it: on the grid it leaves a gap.
          { path: 'pages.home.composer', value: composerPlace(look) },
          { path: 'nav.home.on', value: true },
          { path: 'nav.home.tab', value: true },
        ]
      : []),
  ]
}

/** Where Home's composer sits: under a Home headline always, as on the grid it leaves a gap. */
const composerPlace = (look: Look) => (look.homeHeadline.trim() ? 'band' : look.composer)

/**
 * Home's blocks as the look lays them out, each placed on the grid at its
 * type's usual height; blocks given the same row take its tallest, so they
 * stand side by side. With the composer in the band, the contact block takes
 * the full width as one row, rather than standing beside a list it cannot
 * match in height. Writing them lays Home out again.
 */
function homeBlocks(look: Look) {
  const band = composerPlace(look) === 'band'
  const placed = look.homeBlocks.map(({ type, x, y, w }) =>
    band && type === 'contact' ? { type, x: 0, y, w: 12 } : { type, x, y, w }
  )
  // A row's look-row number becomes grid rows: each look-row as tall as its tallest block.
  const rows = [...new Set(placed.map((block) => block.y))].sort((a, b) => a - b)
  const tallest = rows.map((row) =>
    Math.max(
      ...placed.filter((block) => block.y === row).map((block) => BLOCK_SIZES[block.type].size[1])
    )
  )
  const top = rows.map((_, i) => tallest.slice(0, i).reduce((sum, h) => sum + h, 0))
  return placed.map(({ type, x, y, w }) => {
    const row = rows.indexOf(y)
    return { type, grid: { x, y: top[row]!, w, h: tallest[row]! } }
  })
}

/** A headline's accent phrase, where the headline holds it. */
function accentChanges(look: Look, headline: string, title: string) {
  const phrase = look.accentPhrase.trim()
  return phrase && fit(title, 80).includes(phrase)
    ? [{ path: `${headline}.accent`, value: { style: look.accentStyle, text: { en: phrase } } }]
    : []
}

/** A look's design: its preset with every choice it makes that the design accepts. */
export function lookDesign(
  base: PortalDesign,
  look: Look,
  allows: Omit<UntrustedChanges, 'links'>
) {
  const preset = DESIGN_PRESETS.find((candidate) => candidate.id === look.preset)!
  return applyDesignChanges(applyPreset(base, preset), lookChanges(look), 'site', {
    ...allows,
    links: new Set(),
    files: new Set(),
  })
}

export interface DesignLook {
  name: string
  description: string
  /** The preset the look starts from. */
  preset: string
  design: PortalDesign
}

export type DirectionsResult =
  | { ok: true; looks: DesignLook[] }
  | { ok: false; code: 'AI_UNAVAILABLE' | 'AI_FAILED' | 'AI_LIMIT'; message: string }

/** A JPEG data URL as an image part. */
const jpegPart = (dataUrl: string): ContentPart => ({
  type: 'image',
  source: {
    type: 'data',
    value: dataUrl.replace(/^data:image\/jpeg;base64,/, ''),
    mimeType: 'image/jpeg',
  },
})

/** Below this chroma a colour is a neutral, such as a monochrome brand's near-black. */
const NEUTRAL_CHROMA = 0.04

/**
 * The faithful look's accent: the model's colour where the colours measured
 * from their buttons, links and logo bear it out, as that measured colour;
 * else the colour measured as most surely theirs. A near-black the model
 * reads stays: a monochrome brand's buttons are black, which no colourful
 * measurement shows.
 */
export function measuredAccent(accent: string, colours: readonly string[]): string {
  const chosen = oklchOf(accent)
  if (!colours.length || !chosen || chosen.c < NEUTRAL_CHROMA) return accent
  if (confirmedBy(colours)(accent)) return faithfulAccent(accent, { palette: [...colours] })
  return colours[0]!
}

/** Three complete looks from a few words, or screenshots and brand images; each valid and solved. */
export async function designDirections(input: {
  design: PortalDesign
  /** The workspace's name, which the portal shows. */
  name?: string | null
  /** Whether the workspace has a logo mark, which the header can show beside the name. */
  hasMark?: boolean
  words: string | null
  /** Up to three screenshots or brand images, as JPEG data URLs, for a model that reads images. */
  images?: string[] | null
  /**
   * Colours measured from what the images show on purpose (buttons, links,
   * a header band, the logo), most surely the brand's first.
   */
  colours?: string[] | null
  /** The images' main colours by area, which a hero's fill is checked against. */
  palette?: string[] | null
  allows: Omit<UntrustedChanges, 'links'>
}): Promise<DirectionsResult> {
  const model = designAiModel()
  if (!model) {
    return {
      ok: false,
      code: 'AI_UNAVAILABLE',
      message: 'Quackback AI is not set up for this workspace.',
    }
  }
  const limited = await allowanceRefusal()
  if (limited) return limited
  const images = input.images ?? []
  const colours = input.colours ?? []
  const brief = [
    input.name && `The company: ${input.name}.`,
    input.hasMark && 'They have a logo mark, a square icon the header can show beside their name.',
    input.words && `In their words: ${input.words}`,
    colours.length > 0 &&
      `Colours measured from their buttons, links, header and logo, most surely their brand colour first: ${colours.join(', ')}. Use the first as the accent in the first look unless their images plainly lead with another of these.`,
    input.palette?.length && `Their images' main colours by area: ${paletteText(input.palette)}`,
    images.length > 0 &&
      `${images.length === 1 ? 'The image is' : `The ${images.length} images are`} screenshots of their website or app, or their brand guidelines. Read their brand from them: which colour leads and which comes second, whether the type is serif, geometric, humanist or condensed, how large and heavy the headlines are, whether headlines, menu or buttons are in capitals, how round the buttons and shapes are, how the hero is laid out, and how light or dark the pages are. Ignore cookie banners and pop-ups.`,
  ]
    .filter(Boolean)
    .join('\n')
  const text = brief || 'Suggest three looks for a software company.'
  // The hero, read on its own from the first screenshot while the looks are written.
  const heroRead = images[0] ? readHero(model, images[0]) : Promise.resolve(null)
  const content = (withImages: boolean) => () =>
    withImages && images.length
      ? [{ type: 'text' as const, content: text }, ...images.map(jpegPart)]
      : text
  const systemPrompt = directionsPrompt(input.allows.blockTypes)
  try {
    // A model that does not read images still has the colours.
    const written = await writeLooks({ model, systemPrompt, content: content(true) }).catch(
      (err: unknown) => {
        if (!images.length || isStructuredOutputError(err)) throw err
        log.warn({ err }, 'design ai could not read the image; using its colours alone')
        return writeLooks({ model, systemPrompt, content: content(false) })
      }
    )
    const hero = await heroRead
    // A hero's colour is taken only where what was measured bears it out.
    const confirm = confirmedBy([...colours, ...(input.palette ?? [])])
    return {
      ok: true,
      looks: written.flatMap((answered, index) => {
        if (!answered) return []
        // The first look is the faithful one: it keeps their exact brand colour.
        const look =
          index === 0
            ? withHero(
                {
                  ...answered,
                  accent: measuredAccent(answered.accent, colours),
                  support:
                    answered.support &&
                    faithfulAccent(answered.support, {
                      palette: [...colours, ...(input.palette ?? [])],
                    }),
                },
                // What the screenshot's hero shows comes last: it is what was seen.
                hero,
                confirm
              )
            : answered
        const { design, refused } = lookDesign(input.design, look, input.allows)
        if (refused.length) log.info({ look: look.name, refused }, 'design look left choices out')
        return {
          name: fit(look.name, 40),
          description: fit(look.description, 140),
          preset: look.preset,
          design,
        }
      }),
    }
  } catch (err) {
    if (!isStructuredOutputError(err)) throw err
    log.warn({ err }, 'design ai directions did not fit the schema')
    return {
      ok: false,
      code: 'AI_FAILED',
      message: 'Quackback AI could not suggest looks. Try again.',
    }
  }
}
