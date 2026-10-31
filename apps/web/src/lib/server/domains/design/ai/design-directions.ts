/**
 * Three complete starting designs from a website, a few words, or a logo or
 * screenshot: the brand, the shapes and layout, Home, the words and the
 * composer's wording, so the first look is a whole portal, not a palette.
 * Each look goes through applyDesignChanges as the model's untrusted output,
 * so the schema, the contrast solver and the workspace's pages decide what
 * reaches it.
 */
import { z } from 'zod'
import type { ContentPart } from '@tanstack/ai'
import { structuredChat } from '@/lib/server/domains/ai/structured-chat'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { logger } from '@/lib/server/logger'
import { applyDesignChanges, type UntrustedChanges } from '@/lib/shared/design/apply-changes'
import { BLOCK_WIDTHS, BUNDLED_FONT_IDS, DESIGN_OPTIONS } from '@/lib/shared/design/options'
import type { HomeBlockType } from '@/lib/shared/design/home'
import { brandColour, colourVividness } from '@/lib/shared/design/palette'
import { applyPreset, DESIGN_PRESETS } from '@/lib/shared/design/presets'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { designAiModel, isStructuredOutputError, paletteText } from './design-ai'
import type { SiteSignals } from './site-signals'

const log = logger.child({ module: 'design-directions' })

const PRESET_IDS = DESIGN_PRESETS.map((preset) => preset.id) as [string, ...string[]]
const BLOCK_TYPES = Object.keys(BLOCK_WIDTHS) as [HomeBlockType, ...HomeBlockType[]]
const WIDTHS = ['third', 'half', 'two_thirds', 'full'] as const
const hex = z.string().max(32)

const lookSchema = z.object({
  name: z.string().max(40),
  description: z.string().max(140),
  preset: z.enum(PRESET_IDS),
  mode: z.enum(DESIGN_OPTIONS.mode),
  accent: hex,
  background: hex,
  ink: hex,
  /** Cards, or "" to derive them from the background. */
  surface: hex,
  /** Dark mode's page and text, or "" to derive them. */
  darkBackground: hex,
  darkInk: hex,
  headingFont: z.enum(BUNDLED_FONT_IDS),
  bodyFont: z.enum(BUNDLED_FONT_IDS),
  headingWeight: z.enum(['500', '600', '700', '800']),
  corners: z.enum(DESIGN_OPTIONS.corners),
  header: z.enum(['stacked', 'inline', 'centered']),
  nav: z.enum(DESIGN_OPTIONS.nav),
  band: z.enum(['none', 'tint', 'fade', 'brand']),
  cards: z.enum(DESIGN_OPTIONS.cards),
  density: z.enum(DESIGN_OPTIONS.density),
  width: z.enum(DESIGN_OPTIONS.width),
  headline: z.string().max(80),
  subtitle: z.string().max(140),
  postWord: z.enum(DESIGN_OPTIONS.postWord),
  boardWord: z.enum(DESIGN_OPTIONS.boardWord),
  prompt: z.string().max(60),
  submit: z.string().max(24),
  homeHeadline: z.string().max(80),
  homeSubtitle: z.string().max(140),
  homeBlocks: z.array(z.object({ type: z.enum(BLOCK_TYPES), width: z.enum(WIDTHS) })).max(8),
})
type Look = z.infer<typeof lookSchema>

const directionsSchema = z.object({ looks: z.array(lookSchema).min(1).max(3) })

/** An answer the tests keep valid against the design. */
export const DIRECTIONS_EXAMPLE: Look = {
  name: 'Chalk and orange',
  description: 'Their burnt orange as a full band, a geometric face, pill menu and plain cards.',
  preset: 'bold',
  mode: 'light',
  accent: '#d9480f',
  background: '#f7f5f2',
  ink: '#1c1b19',
  surface: '',
  darkBackground: '#161412',
  darkInk: '#f3eee8',
  headingFont: 'space-grotesk',
  bodyFont: 'inter',
  headingWeight: '700',
  corners: 'subtle',
  header: 'inline',
  nav: 'pills',
  band: 'brand',
  cards: 'bordered',
  density: 'comfortable',
  width: 'default',
  headline: 'What should we set next?',
  subtitle: 'Suggest routes, classes and kit for the walls, and vote for the ones you want.',
  postWord: 'suggestion',
  boardWord: 'category',
  prompt: 'Suggest a route, a class or some kit',
  submit: 'Suggest it',
  homeHeadline: 'Climb with us',
  homeSubtitle: 'Suggest what we set next, see what is coming and find help.',
  homeBlocks: [
    { type: 'composer', width: 'two_thirds' },
    { type: 'contact', width: 'third' },
    { type: 'ideas', width: 'half' },
    { type: 'updates', width: 'half' },
    { type: 'roadmap', width: 'full' },
    { type: 'help_topics', width: 'full' },
  ],
}

/** The design system Quackback AI designs with: how a brand becomes each choice. */
function directionsPrompt(blockTypes: readonly HomeBlockType[]): string {
  return `You design a company's customer feedback portal from their brand: three complete looks, each a whole portal. The first, Faithful, is as close to their brand as the options allow; the second is quieter; the third is bolder. Make the three clearly different in layout, type and colour.

How a brand becomes each choice:
- The first look commits to their identity as they present it, even when it is loud: their colour as they use it, never a softened version of it.
- accent: their brand colour, exactly as given or seen. It colours buttons, links and the band. A monochrome brand, whose buttons are black or near-black and which uses colour sparingly, keeps a near-black accent, white pages and no coloured band.
- background and ink: pages stay quiet. Use their page colour when it is light and calm, or a near-white tinted toward the brand; ink is their text colour or a near-black. surface (cards) is "" unless their cards differ from the page.
- mode: dark when their own site is dark (then background and ink are the dark page and its light text), light when their brand is clearly light, auto otherwise. darkBackground and darkInk are dark mode's page and text, tinted toward the brand, or "".
- fonts: the closest bundled fonts to theirs. Serif display: fraunces, playfair, lora, merriweather. Geometric: space-grotesk, poppins, manrope, bricolage-grotesque, jakarta, dm-sans. Humanist or friendly: nunito, ibm-plex-sans, lato, open-sans. Neutral: inter, geist, roboto. Monospace for developer tools: jetbrains, fira-code. Body text is usually a plainer sans than the headings.
- headingWeight: how heavy their headings are, 500 to 800.
- corners: sharp for strict or editorial brands, subtle for most software, rounded for friendly ones, pill for playful ones.
- header: stacked (logo above the menu), inline (one row, for software), centered (for consumer and editorial brands). nav: tabs, underline or pills.
- band, behind the headlines: brand when they fill large areas with their colour, such as a hero; tint or fade for most; none for minimal and monochrome brands.
- cards: bordered, raised, or list rows for minimal and developer brands. density: compact for technical audiences, comfortable mostly, spacious for calm brands. width: narrow for editorial, wide for dense tools, default otherwise.
- words: postWord is what visitors post: feature_request for software and developer tools, suggestion for consumer, retail and hospitality, post for communities, idea otherwise. boardWord: category for consumer brands, board otherwise.
- headline, subtitle (the feedback page) and homeHeadline, homeSubtitle (Home), prompt (the composer, 60 characters) and submit (its button, 24): in their voice, short, inviting, never generic, never naming a competitor.
- homeBlocks: Home, in order, on a six-column grid; each type with its widths: ${BLOCK_TYPES.map((type) => `${type} (${BLOCK_WIDTHS[type].join(', ')})`).join('; ')}. This workspace can show: ${blockTypes.join(', ')}. Lead with the composer; use what they have. Blocks in a row share its height, so pair short blocks (composer, status, contact, help_search) with each other and lists (ideas, updates, roadmap, help_topics) with each other. A row's last block grows to fill it. No links block.

Presets set the starting layout: ${DESIGN_PRESETS.map((preset) => `${preset.id} (${preset.description})`).join('; ')}.
Colours are hex such as #0f766e.

Example look: ${JSON.stringify(DIRECTIONS_EXAMPLE)}`
}

/** Above this, a page background reads as a colour and drowns the brand colour on it. */
const MAX_PAGE_VIVIDNESS = 0.2
const quietPage = (background: string) =>
  !/^#[0-9a-f]{6}$/i.test(background) || colourVividness(background) <= MAX_PAGE_VIVIDNESS

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
    { path: 'brand.fonts.heading', value: look.headingFont },
    { path: 'brand.fonts.body', value: look.bodyFont },
    { path: 'brand.fonts.headingWeight', value: Number(look.headingWeight) },
    { path: 'shape.corners', value: look.corners },
    { path: 'layout.header', value: look.header },
    { path: 'layout.nav', value: look.nav },
    { path: 'layout.cards', value: look.cards },
    { path: 'layout.density', value: look.density },
    { path: 'layout.width', value: look.width },
    { path: 'pages.feedback.headline.title', value: look.headline },
    { path: 'pages.feedback.headline.subtitle', value: look.subtitle },
    { path: 'layout.band', value: look.band },
    { path: 'vocabulary.post', value: look.postWord },
    { path: 'vocabulary.board', value: look.boardWord },
    ...page(look.prompt, 'pages.feedback.copy.prompt'),
    ...page(look.submit, 'pages.feedback.copy.submit'),
    ...(look.homeBlocks.length
      ? [
          { path: 'pages.home.blocks', value: look.homeBlocks },
          ...page(look.homeHeadline, 'pages.home.headline.title'),
          ...page(look.homeSubtitle, 'pages.home.headline.subtitle'),
          { path: 'nav.home.on', value: true },
          { path: 'nav.home.tab', value: true },
        ]
      : []),
  ]
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

/** A JPEG data URL as an image part. */
function imagePart(dataUrl: string): ContentPart {
  return {
    type: 'image',
    source: {
      type: 'data',
      value: dataUrl.replace(/^data:image\/jpeg;base64,/, ''),
      mimeType: 'image/jpeg',
    },
  }
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
      'The image is their logo or a screenshot of their website. Read their brand from it: which colour leads, whether the type is serif, geometric, humanist or condensed, how heavy the headings are, how round the shapes are, and how light or dark the pages are.',
  ]
    .filter(Boolean)
    .join('\n')
  const text = brief || 'Suggest three looks for a software company.'
  const ask = (withImage: boolean) =>
    structuredChat({
      model,
      systemPrompts: [directionsPrompt(input.allows.blockTypes)],
      messages: [
        {
          role: 'user',
          content:
            withImage && input.image
              ? [{ type: 'text', content: text }, imagePart(input.image)]
              : text,
        },
      ],
      schema: directionsSchema,
      maxTokens: 4000,
    })
  try {
    // A model that does not read images still has the colours.
    const answer = await ask(true).catch((err: unknown) => {
      if (!input.image || isStructuredOutputError(err)) throw err
      log.warn({ err }, 'design ai could not read the image; using its colours alone')
      return ask(false)
    })
    return {
      ok: true,
      looks: answer.looks.map((look) => {
        const { design, refused } = lookDesign(input.design, look, input.allows)
        if (refused.length) log.info({ look: look.name, refused }, 'design look left choices out')
        return { name: look.name, description: look.description, preset: look.preset, design }
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
