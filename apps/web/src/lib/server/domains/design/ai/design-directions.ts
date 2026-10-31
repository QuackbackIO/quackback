/**
 * Three complete starting designs from a website, a few words, or a logo or
 * screenshot: the brand, the shapes and layout, Home, the words and the
 * composer's wording, so the first look is a whole portal, not a palette.
 * Each look goes through applyDesignChanges as the model's untrusted output,
 * so the schema, the contrast solver and the workspace's pages decide what
 * reaches it.
 */
import type { ContentPart } from '@tanstack/ai'
import { structuredChat } from '@/lib/server/domains/ai/structured-chat'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { logger } from '@/lib/server/logger'
import { applyDesignChanges, type UntrustedChanges } from '@/lib/shared/design/apply-changes'
import { brandColour, colourVividness } from '@/lib/shared/design/palette'
import { applyPreset, DESIGN_PRESETS } from '@/lib/shared/design/presets'
import { directionsPrompt, directionsSchema, type Look } from './design-looks'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { designAiModel, isStructuredOutputError, paletteText } from './design-ai'
import type { SiteAssets } from './site-assets'
import type { SiteSignals } from './site-signals'

const log = logger.child({ module: 'design-directions' })

export { DIRECTIONS_EXAMPLE } from './design-looks'

/** Above this, a page background reads as a colour and drowns the brand colour on it. */
const MAX_PAGE_VIVIDNESS = 0.2
const quietPage = (background: string) =>
  !/^#[0-9a-f]{6}$/i.test(background) || colourVividness(background) <= MAX_PAGE_VIVIDNESS

/** Text cut at a word boundary to fit a field; a long answer is trimmed rather than refused. */
function fit(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  return cut.slice(0, cut.lastIndexOf(' ') > max / 2 ? cut.lastIndexOf(' ') : max).trim()
}

/** A look as changes to its preset's design, in the order they build on each other. */
function lookChanges(
  look: Look,
  assets: SiteAssets | null
): Array<{ path: string; value: unknown }> {
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
    { path: 'brand.fonts.heading', value: look.headingFont },
    { path: 'brand.fonts.body', value: look.bodyFont },
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
    ...(look.band === 'blend' ? [{ path: 'layout.blend', value: look.blend }] : []),
    { path: 'layout.band', value: look.band },
    { path: 'layout.bandAlign', value: look.bandAlign },
    { path: 'layout.bandShape', value: look.bandShape },
    { path: 'layout.headerOnBand', value: look.headerOnBand },
    { path: 'brand.fonts.scale', value: look.scale },
    { path: 'brand.fonts.tracking', value: look.tracking },
    { path: 'brand.fonts.headlineCase', value: look.headlineCase },
    { path: 'brand.fonts.labelCase', value: look.labelCase },
    { path: 'shape.buttons', value: look.buttons },
    // Brand status colours need the logo's colours, which only an imported wordmark gives.
    {
      path: 'layout.status',
      value:
        look.status === 'brand' && (assets?.wordmark?.colours.length ?? 0) < 2
          ? 'colour'
          : look.status,
    },
    ...(assets?.wordmark
      ? [
          { path: 'brand.logo.wordmark.light', value: { key: assets.wordmark.key } },
          ...(assets.wordmark.colours.length > 1
            ? [{ path: 'brand.logoColours', value: assets.wordmark.colours }]
            : []),
        ]
      : []),
    {
      path: 'brand.logo.display',
      value: look.logo === 'wordmark' && !assets?.wordmark ? 'mark_and_name' : look.logo,
    },
    ...(assets?.shareImage && look.shareImage !== 'none'
      ? [
          { path: 'brand.bandImage', value: { key: assets.shareImage.key } },
          { path: 'layout.imagePlace', value: look.shareImage },
        ]
      : []),
    { path: 'vocabulary.post', value: look.postWord },
    { path: 'vocabulary.board', value: look.boardWord },
    ...page(fit(look.prompt, 60), 'pages.feedback.copy.prompt'),
    ...page(fit(look.submit, 24), 'pages.feedback.copy.submit'),
    ...accentChanges(look, 'pages.feedback.headline', look.headline),
    ...(look.homeBlocks.length
      ? [
          { path: 'pages.home.blocks', value: look.homeBlocks },
          ...page(fit(look.homeHeadline, 80), 'pages.home.headline.title'),
          ...page(fit(look.homeSubtitle, 140), 'pages.home.headline.subtitle'),
          ...accentChanges(look, 'pages.home.headline', look.homeHeadline),
          { path: 'pages.home.composer', value: look.composer },
          { path: 'nav.home.on', value: true },
          { path: 'nav.home.tab', value: true },
        ]
      : []),
  ]
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
  allows: Omit<UntrustedChanges, 'links'>,
  assets: SiteAssets | null = null
) {
  const preset = DESIGN_PRESETS.find((candidate) => candidate.id === look.preset)!
  // The files stored for this start are the only new ones a look may place.
  const files = new Set(
    [assets?.wordmark?.key, assets?.shareImage?.key].filter((key): key is string => !!key)
  )
  return applyDesignChanges(applyPreset(base, preset), lookChanges(look, assets), 'site', {
    ...allows,
    links: new Set(),
    files,
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
  | { ok: false; code: 'AI_UNAVAILABLE' | 'AI_FAILED'; message: string }

/** Image bytes as an image part. */
function imagePart(base64: string, mimeType: string): ContentPart {
  return { type: 'image', source: { type: 'data', value: base64, mimeType } }
}

/** A JPEG data URL as an image part. */
const jpegPart = (dataUrl: string) =>
  imagePart(dataUrl.replace(/^data:image\/jpeg;base64,/, ''), 'image/jpeg')

/** What was imported from the website, as the model reads it. */
function assetsBrief(assets: SiteAssets | null, imageFirst: boolean): string | null {
  if (!assets) return null
  return [
    assets.wordmark && 'Their wordmark was found in their header and is ready to use.',
    assets.wordmark &&
      assets.wordmark.colours.length > 1 &&
      `Their logo's colours: ${assets.wordmark.colours.join(', ')}.`,
    assets.shareImage &&
      `Their share image, the picture link previews show, is attached as the ${imageFirst ? 'second' : 'first'} image.`,
  ]
    .filter(Boolean)
    .join(' ')
}

/** What the website says about its brand, as the model reads it. */
function siteBrief(site: SiteSignals): string {
  return [
    `Website ${site.domain}${site.title ? `, titled "${site.title}"` : ''}${site.description ? `: ${site.description}` : ''}.`,
    site.colour && `Its brand colour is ${site.colour}.`,
    site.palette.length > 1 &&
      `Its other colours, most used first: ${site.palette.slice(1).join(', ')}.`,
    site.background && `Its pages are ${site.dark ? 'dark' : 'light'}, on ${site.background}.`,
    (site.fonts.heading || site.fonts.body) &&
      `It sets headings in ${site.fonts.heading ?? site.fonts.body} and text in ${site.fonts.body ?? site.fonts.heading}.`,
    site.button && `Its buttons are filled ${site.button}.`,
    site.monochrome &&
      'It is a monochrome brand: black buttons and little colour. Keep the first look monochrome: a near-black accent, white pages and no coloured band.',
    site.bold && 'It fills large areas, such as its hero, with its brand colour.',
  ]
    .filter(Boolean)
    .join(' ')
}

/** Three complete looks from a website, a few words, or a logo or screenshot; each valid and solved. */
export async function designDirections(input: {
  design: PortalDesign
  /** The workspace's name, which the portal shows. */
  name?: string | null
  site: SiteSignals | null
  words: string | null
  /** The main colours of their logo or a screenshot. */
  palette?: string[] | null
  /** The logo or screenshot itself, as a JPEG data URL, for a model that reads images. */
  image?: string | null
  /** What was imported from the website, stored and ready to place. */
  assets?: SiteAssets | null
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
  await enforceAiTokenBudget()
  const brief = [
    input.name && `The company: ${input.name}.`,
    input.site && siteBrief(input.site),
    input.words && `In their words: ${input.words}`,
    input.palette?.length &&
      `Colours from their logo or a screenshot: ${paletteText(input.palette)}${brandColour(input.palette) ? ' Use the brand colour as the accent in the first look, as it is.' : ''}`,
    input.image &&
      'The first image is their logo or a screenshot of their website. Read their brand from it: which colour leads and which comes second, whether the type is serif, geometric, humanist or condensed, how large and heavy the headlines are, whether headlines, menu or buttons are in capitals, how round the buttons and shapes are, how the hero is laid out, and how light or dark the pages are.',
    assetsBrief(input.assets ?? null, !!input.image),
  ]
    .filter(Boolean)
    .join('\n')
  const text = brief || 'Suggest three looks for a software company.'
  const share = input.assets?.shareImage
  const ask = (withImages: boolean) => {
    const images = withImages
      ? [
          ...(input.image ? [jpegPart(input.image)] : []),
          ...(share ? [imagePart(share.base64, share.mimeType)] : []),
        ]
      : []
    return structuredChat({
      model,
      systemPrompts: [directionsPrompt(input.allows.blockTypes)],
      messages: [
        {
          role: 'user',
          content: images.length ? [{ type: 'text', content: text }, ...images] : text,
        },
      ],
      schema: directionsSchema,
      // Three complete looks are long, and some models reason before they answer.
      maxTokens: 10000,
    })
  }
  try {
    // A model that does not read images still has the colours, and a long
    // answer that does not fit the schema is asked for once more.
    const once = () =>
      ask(true).catch((err: unknown) => {
        if ((!input.image && !share) || isStructuredOutputError(err)) throw err
        log.warn({ err }, 'design ai could not read the image; using its colours alone')
        return ask(false)
      })
    const answer = await once().catch((err: unknown) => {
      if (!isStructuredOutputError(err)) throw err
      log.warn({ err }, 'design ai looks did not fit the schema; asking again')
      return once()
    })
    return {
      ok: true,
      looks: answer.looks.map((look) => {
        const { design, refused } = lookDesign(input.design, look, input.allows, input.assets)
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
