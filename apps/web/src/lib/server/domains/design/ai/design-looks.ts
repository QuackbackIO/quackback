/**
 * What Quackback AI answers when it starts a design: three looks, each every
 * choice a whole portal makes, and the design system that turns a brand into
 * those choices.
 */
import { z } from 'zod'
import { BLOCK_WIDTHS, BUNDLED_FONT_IDS, DESIGN_OPTIONS } from '@/lib/shared/design/options'
import type { HomeBlockType } from '@/lib/shared/design/home'
import { DESIGN_PRESETS } from '@/lib/shared/design/presets'

const PRESET_IDS = DESIGN_PRESETS.map((preset) => preset.id) as [string, ...string[]]
const BLOCK_TYPES = Object.keys(BLOCK_WIDTHS) as [HomeBlockType, ...HomeBlockType[]]
const WIDTHS = ['third', 'half', 'two_thirds', 'full'] as const
const hex = z.string().max(32)

export const lookSchema = z.object({
  name: z.string(),
  description: z.string(),
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
  /** A second brand colour, or "" for none. */
  support: hex,
  band: z.enum(DESIGN_OPTIONS.band),
  blend: z.enum(DESIGN_OPTIONS.blend),
  bandAlign: z.enum(DESIGN_OPTIONS.bandAlign),
  bandShape: z.enum(DESIGN_OPTIONS.bandShape),
  headerOnBand: z.boolean(),
  scale: z.enum(DESIGN_OPTIONS.typeScale),
  tracking: z.enum(DESIGN_OPTIONS.tracking),
  headlineCase: z.enum(DESIGN_OPTIONS.textCase),
  labelCase: z.enum(DESIGN_OPTIONS.textCase),
  /** A phrase of the headline to set apart, or "". */
  accentPhrase: z.string(),
  accentStyle: z.enum(DESIGN_OPTIONS.headlineAccent),
  buttons: z.enum(DESIGN_OPTIONS.buttons),
  status: z.enum(DESIGN_OPTIONS.status),
  logo: z.enum(DESIGN_OPTIONS.logoDisplay),
  composer: z.enum(DESIGN_OPTIONS.composerPlace),
  shareImage: z.enum(['none', 'side', 'edge', 'cover']),
  cards: z.enum(DESIGN_OPTIONS.cards),
  density: z.enum(DESIGN_OPTIONS.density),
  width: z.enum(DESIGN_OPTIONS.width),
  headline: z.string(),
  subtitle: z.string(),
  postWord: z.enum(DESIGN_OPTIONS.postWord),
  boardWord: z.enum(DESIGN_OPTIONS.boardWord),
  prompt: z.string(),
  submit: z.string(),
  homeHeadline: z.string(),
  homeSubtitle: z.string(),
  homeBlocks: z.array(z.object({ type: z.enum(BLOCK_TYPES), width: z.enum(WIDTHS) })).max(8),
})
export type Look = z.infer<typeof lookSchema>

export const directionsSchema = z.object({ looks: z.array(lookSchema).min(1).max(3) })

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
  support: '',
  band: 'brand',
  blend: 'linear',
  bandAlign: 'left',
  bandShape: 'full',
  headerOnBand: false,
  scale: 'large',
  tracking: 'tight',
  headlineCase: 'sentence',
  labelCase: 'sentence',
  accentPhrase: '',
  accentStyle: 'colour',
  buttons: 'match',
  status: 'colour',
  logo: 'name',
  composer: 'band',
  shareImage: 'none',
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
    { type: 'composer', width: 'full' },
    { type: 'contact', width: 'full' },
    { type: 'ideas', width: 'half' },
    { type: 'updates', width: 'half' },
    { type: 'roadmap', width: 'full' },
    { type: 'help_topics', width: 'full' },
  ],
}

/** The design system Quackback AI designs with: how a brand becomes each choice. */
export function directionsPrompt(blockTypes: readonly HomeBlockType[]): string {
  return `You design a company's customer feedback portal from their brand: three complete looks, each a whole portal. The first, Faithful, is as close to their brand as the options allow; the second is quieter; the third is bolder. Make the three clearly different in layout, type and colour.

How a brand becomes each choice:
- The first look commits to their identity as they present it, even when it is loud: their colour as they use it, never a softened version of it.
- Colours in the brief are read from their own CSS and are exact. A screenshot can be dimmed by a cookie banner or an overlay, so take a colour from it only when the brief gives none.
- accent: their brand colour, exactly as the brief gives it. Never darken or lighten it to make text readable: the portal picks text that reads on it. It colours buttons, links and the band. A monochrome brand, whose buttons are black or near-black and which uses colour sparingly, keeps a near-black accent, white pages and no coloured band.
- background and ink: pages stay quiet. Use their page colour when it is light and calm, or a near-white tinted toward the brand; ink is their text colour or a near-black. surface (cards) is "" unless their cards differ from the page.
- mode: dark when their own site is dark (then background and ink are the dark page and its light text), light when their brand is clearly light, auto otherwise. darkBackground and darkInk are dark mode's page and text, tinted toward the brand, or "".
- support: their second signature colour when they pair two (a bright one with a deep one, or two that share the stage), else "". Never a grey.
- fonts: the closest bundled fonts to theirs. Serif display: fraunces, playfair, lora, merriweather, source-serif. Geometric: space-grotesk, poppins, manrope, bricolage-grotesque, jakarta, dm-sans, sora, outfit. Grotesque and neo-grotesque: inter-tight, instrument-sans, work-sans, libre-franklin, figtree. Condensed, for heavy poster headlines: barlow-condensed, oswald. Humanist or friendly: nunito, ibm-plex-sans, lato, open-sans, noto-sans, rubik, karla. Neutral: inter, geist, roboto. Monospace for developer tools: jetbrains, fira-code. Body text is usually a plainer sans than the headings.
- headingWeight: how heavy their headings are, 500 to 800.
- scale: display for loud, poster-like heroes with very large headlines; large for confident ones; standard for quiet, text-led brands. tracking: tight for large modern headlines, normal otherwise. headlineCase: upper only when their headlines are set in capitals. labelCase: upper when their menu and buttons are in capitals.
- accentPhrase: a short phrase copied exactly from your headline to set apart, when their site colours or highlights part of a headline; the whole headline when their headlines are set in their brand colour; "" otherwise. accentStyle: colour on dark or bold bands, highlight on light, editorial ones.
- buttons: their buttons' shape: square, rounded, pill, or match to follow the corners.
- status: ink for monochrome and minimal brands, pill for soft and friendly ones, brand when their logo has several colours (only when the brief lists them), colour otherwise.
- corners: sharp for strict or editorial brands, subtle for most software, rounded for friendly ones, pill for playful ones.
- header: stacked (logo above the menu), inline (one row, for software), centered (for consumer and editorial brands). nav: tabs, underline or pills.
- band, behind the headlines: brand when they fill large areas with their colour, such as a hero; support when that colour is their second one; blend when their brand uses a gradient, with blend linear for a bold sweep and mesh for soft colour beside the words on a white page; tint or fade for most light brands; none for minimal and monochrome brands. A dark site takes none (its own dark page) or brand, never fade, which muddies a dark page.
- bandAlign: centre for consumer and campaign-style heroes, left for software. bandShape: inset when their hero sits in a large rounded card, panel when their hero sets the words on a block of colour over another colour or a photo, full otherwise. headerOnBand: true when their header shares their hero's colour.
- logo: wordmark when the brief says their wordmark was found; name when their logo is their name set in type; mark_and_name otherwise.
- composer: band for most looks, putting the composer in the hero under Home's headline; block keeps it on the grid. With it in the band, give the contact block the full width.
- shareImage: when the brief attaches their share image, side if it is a photo of their product, place or people with no words or logo on it, else none. edge or cover only for an illustration or texture with nothing important at its edges.
- cards: bordered, raised, or list rows for minimal and developer brands. density: compact for technical audiences, comfortable mostly, spacious for calm brands. width: narrow for editorial, wide for dense tools, default otherwise.
- words: postWord is what visitors post: feature_request for software and developer tools, suggestion for consumer, retail and hospitality, post for communities, idea otherwise. boardWord: category for consumer brands, board otherwise.
- headline, subtitle (the feedback page) and homeHeadline, homeSubtitle (Home), prompt (the composer, 60 characters) and submit (its button, 24): in their voice, short, inviting, never generic, never naming a competitor.
- homeBlocks: Home, in order, on a six-column grid; each type with its widths: ${BLOCK_TYPES.map((type) => `${type} (${BLOCK_WIDTHS[type].join(', ')})`).join('; ')}. This workspace can show: ${blockTypes.join(', ')}. Lead with the composer; use what they have. Blocks in a row share its height, so pair short blocks (composer, status, contact, help_search) with each other and lists (ideas, updates, roadmap, help_topics) with each other. A row's last block grows to fill it. No links block.

Presets set the starting layout: ${DESIGN_PRESETS.map((preset) => `${preset.id} (${preset.description})`).join('; ')}.
Colours are hex such as #0f766e.

Example look: ${JSON.stringify(DIRECTIONS_EXAMPLE)}`
}
