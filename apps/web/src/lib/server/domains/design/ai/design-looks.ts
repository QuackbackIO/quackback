/**
 * What Quackback AI answers when it starts a design: three looks, each every
 * choice a whole portal makes, and the design system that turns a brand into
 * those choices.
 */
import { z } from 'zod'
import { BLOCK_SIZES, DESIGN_OPTIONS } from '@/lib/shared/design/options'
import type { HomeBlockType } from '@/lib/shared/design/home'
import { DESIGN_PRESETS } from '@/lib/shared/design/presets'
import { WORDS_LIMITS } from './words-evidence'

const PRESET_IDS = DESIGN_PRESETS.map((preset) => preset.id) as [string, ...string[]]
const BLOCK_TYPES = Object.keys(BLOCK_SIZES) as [HomeBlockType, ...HomeBlockType[]]
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
  // Faces are named as plain text and checked after: three enums of every
  // bundled face make the grammar a strict answer is held to too large to compile.
  headingFont: z.string(),
  /** The headlines' own face, or "" for the heading font. */
  displayFont: z.string(),
  bodyFont: z.string(),
  headingWeight: z.enum(['300', '400', '500', '600', '700', '800']),
  corners: z.enum(DESIGN_OPTIONS.corners),
  header: z.enum(['stacked', 'inline', 'centered']),
  nav: z.enum(DESIGN_OPTIONS.nav),
  /** A second brand colour, or "" for none. */
  support: hex,
  hero: z.enum(DESIGN_OPTIONS.hero),
  blend: z.enum(DESIGN_OPTIONS.blend),
  heroAlign: z.enum(DESIGN_OPTIONS.heroAlign),
  heroShape: z.enum(DESIGN_OPTIONS.heroShape),
  headerOnHero: z.boolean(),
  pageTitles: z.enum(DESIGN_OPTIONS.pageTitles),
  scale: z.enum(DESIGN_OPTIONS.typeScale),
  tracking: z.enum(DESIGN_OPTIONS.tracking),
  headlineCase: z.enum(DESIGN_OPTIONS.textCase),
  labelCase: z.enum(DESIGN_OPTIONS.textCase),
  /** A phrase of the headline to set apart, or "". */
  accentPhrase: z.string(),
  accentStyle: z.enum(DESIGN_OPTIONS.headlineAccent),
  buttons: z.enum(DESIGN_OPTIONS.buttons),
  fill: z.enum(DESIGN_OPTIONS.fill),
  status: z.enum(DESIGN_OPTIONS.status),
  composer: z.enum(DESIGN_OPTIONS.composerPlace),
  heroArt: z.enum(DESIGN_OPTIONS.heroArt),
  headlineColour: z.enum(DESIGN_OPTIONS.inkOrAccent),
  tint: z.enum(DESIGN_OPTIONS.tint),
  action: z.enum(DESIGN_OPTIONS.action),
  cards: z.enum(DESIGN_OPTIONS.cards),
  density: z.enum(DESIGN_OPTIONS.density),
  width: z.enum(DESIGN_OPTIONS.width),
  headline: z.string(),
  subtitle: z.string(),
  prompt: z.string(),
  submit: z.string(),
  homeHeadline: z.string(),
  homeSubtitle: z.string(),
  /**
   * The other pages' titles and lines, in their voice: the roadmap's title and
   * line, then the changelog's, the help centre's and support's. A flat list,
   * as nested objects grow the grammar a strict answer is held to past what
   * the provider compiles.
   */
  pageWords: z.array(z.string()).max(8),
  /**
   * Home's blocks by their place on its twelve-column grid: column and row
   * from 0 and columns wide; each takes its type's usual height. Flat, to
   * keep the grammar small.
   */
  homeBlocks: z
    .array(
      z.object({
        type: z.enum(BLOCK_TYPES),
        x: z.number().int().min(0).max(11),
        y: z.number().int().min(0).max(99),
        w: z.number().int().min(1).max(12),
      })
    )
    .max(8),
})
export type Look = z.infer<typeof lookSchema>

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
  displayFont: '',
  bodyFont: 'inter',
  headingWeight: '700',
  corners: 'subtle',
  header: 'inline',
  nav: 'pills',
  support: '',
  hero: 'brand',
  blend: 'linear',
  heroAlign: 'left',
  heroShape: 'full',
  headerOnHero: false,
  pageTitles: 'band',
  scale: 'large',
  tracking: 'tight',
  headlineCase: 'sentence',
  labelCase: 'sentence',
  accentPhrase: '',
  accentStyle: 'colour',
  buttons: 'match',
  fill: 'accent',
  status: 'colour',
  composer: 'band',
  heroArt: 'none',
  headlineColour: 'ink',
  tint: 'neutral',
  action: 'buttons',
  cards: 'bordered',
  density: 'comfortable',
  width: 'default',
  headline: 'What should we set next?',
  subtitle: 'Suggest routes, classes and kit for the walls, and vote for the ones you want.',
  prompt: 'A route, a class or some kit?',
  submit: 'Suggest it',
  homeHeadline: 'Climb with us',
  homeSubtitle: 'Suggest what we set next, see what is coming and find help.',
  pageWords: [
    'On the wall next',
    'Routes and features we are setting now.',
    'Fresh chalk',
    'Everything new at the gym and in the app.',
    'How can we help?',
    'Memberships, classes and your account.',
    'Talk to the desk',
    'Your conversations with our team.',
  ],
  homeBlocks: [
    { type: 'composer', x: 0, y: 0, w: 12 },
    { type: 'contact', x: 0, y: 1, w: 12 },
    { type: 'ideas', x: 0, y: 2, w: 6 },
    { type: 'updates', x: 6, y: 2, w: 6 },
    { type: 'roadmap', x: 0, y: 3, w: 12 },
    { type: 'help_topics', x: 0, y: 4, w: 12 },
  ],
}

/** The design system Quackback AI designs with: how a brand becomes each choice. */
export function directionsPrompt(blockTypes: readonly HomeBlockType[]): string {
  return `You design a company's customer feedback portal from their brand: three complete looks, each a whole portal. The first, Faithful, is as close to their brand as the options allow; the second is quieter; the third is bolder. Make the three clearly different in layout, type and colour.

How a brand becomes each choice:
- The first look commits to their identity as they present it, even when it is loud: their colour as they use it, never a softened version of it.
- Colours in the brief are measured from their own images and are exact. A screenshot can be dimmed by a cookie banner or an overlay, so take a colour the brief does not list only with care.
- accent: their brand colour, exactly as the brief gives it. Never darken or lighten it to make text readable: the portal picks text that reads on it. It colours buttons, links and the band. A monochrome brand, whose buttons are black or near-black and which uses colour sparingly, keeps a near-black accent, white pages and no coloured band.
- background and ink: pages stay quiet. Use their page colour when it is light and calm, or a near-white tinted toward the brand; ink is their text colour or a near-black. surface (cards) is "" unless their cards differ from the page.
- mode: dark when their own site is dark (then background and ink are the dark page and its light text), light when their brand is clearly light, auto otherwise. darkBackground and darkInk are dark mode's page and text, tinted toward the brand, or "".
- support: their second signature colour when they pair two (a bright one with a deep one, or two that share the stage), else "". Never a grey.
- fonts: the closest bundled fonts to theirs. Serif display: fraunces, playfair, lora, merriweather, source-serif. Geometric: space-grotesk, poppins, manrope, bricolage-grotesque, jakarta, dm-sans, sora, outfit. Grotesque and neo-grotesque: inter-tight, instrument-sans, work-sans, libre-franklin, figtree, hanken-grotesk (light, neutral), mona-sans (expressive, wide-ranging). Condensed, for heavy poster headlines: barlow-condensed, oswald. Humanist or friendly: nunito, ibm-plex-sans, lato, open-sans, noto-sans, rubik, karla. Neutral: inter, geist, roboto. Monospace for developer tools: jetbrains, fira-code. Body text is usually a plainer sans than the headings.
- displayFont: their hero headlines' face when it differs from their other headings, such as a condensed poster face over a plain grotesque, else "". Keep headingFont for the section headings, which are small.
- headingWeight: how heavy their headings are, 300 to 800; 300 or 400 when their large headlines are set light.
- scale: display for loud, poster-like heroes with very large headlines; large for confident ones; standard for quiet, text-led brands. tracking: tight for large modern headlines, normal otherwise. headlineCase: upper only when their headlines are set in capitals. labelCase: upper when their menu and buttons are in capitals.
- accentPhrase: a short phrase copied exactly from your headline to set apart, when their site colours or highlights part of a headline; the whole headline when their headlines are set in their brand colour; "" otherwise. accentStyle: colour on dark or bold bands, highlight on light, editorial ones.
- buttons: their buttons' shape: square, rounded, pill, or match to follow the corners. fill: ink when their main buttons are black or in their text colour while their brand colour is kept for the logo and links, accent otherwise.
- status: ink for monochrome and minimal brands, pill for soft and friendly ones, brand when their logo has several colours (only when the brief lists them), colour otherwise.
- corners: sharp for strict or editorial brands, subtle for most software, rounded for friendly ones, pill for playful ones.
- header: stacked (logo above the menu), inline (one row, for software), centered (for consumer and editorial brands). nav: tabs, underline, pills or plain.
- band, behind the headlines: brand when they fill large areas with their colour, such as a hero; support when that colour is their second one; blend when their brand uses a gradient, with blend linear for a bold sweep and mesh for soft colour beside the words on a white page; tint or fade for most light brands; none for minimal and monochrome brands. A dark site takes none (its own dark page) or brand, never fade, which muddies a dark page.
- heroAlign: centre for consumer and campaign-style heroes, left for software. heroShape: inset when their hero sits in a large rounded card, panel when their hero sets the words on a block of colour over another colour or a photo, full otherwise. headerOnHero: true when their header shares their hero's colour. pageTitles: band when their site's other pages open on a coloured hero as their home page does, plain when they open on a simple title.
- composer: band for most looks, putting the composer in the hero under Home's headline; block keeps it on the grid. With it in the band, give the contact block the full width.
- heroArt, for a band with colour and no image: none for most software; hills or waves for outdoor, travel, food and drink brands; petals or confetti for playful consumer ones; dots, grid or lines for a quiet texture. It is drawn in their colours.
- headlineColour: accent when their headlines are set in their brand colour, ink otherwise.
- cards: filled when their site puts content on soft panels without edges, its own colour against a tinted page; give surface then.
- tint: support when they have a second colour that suits the vote box and the current menu item, such as a soft or bright one; neutral otherwise. action: support when their main call to action is in their second colour; accent when it is in their brand colour while their other buttons are dark text-coloured ones; buttons otherwise.
- cards: bordered, raised, or list rows for minimal and developer brands. density: compact for technical audiences, comfortable mostly, spacious for calm brands. width: narrow for editorial, wide for dense tools, default otherwise.
- headline, subtitle (the feedback page) and homeHeadline, homeSubtitle (Home), prompt (the composer, ${WORDS_LIMITS.prompt} characters, to fit a phone's input whole) and submit (its button, 24): in their voice, short, inviting, never generic, never naming a competitor.
- pageWords: eight lines, in the same voice: the roadmap's title and its one-line subtitle, then the changelog's, the help centre's and support's. Never just the page's name, such as "Roadmap", unless their own site titles it so.
- homeBlocks: Home on a twelve-column grid, like a dashboard's panels: each block's column x (0 to 11), row y and width w in columns; each takes its type's usual height, and blocks float up to fill gaps. Give blocks side by side the same y, widths adding up to 12, and the next row a higher y. Least widths: ${BLOCK_TYPES.map((type) => `${type} ${BLOCK_SIZES[type].min[0]}`).join(', ')}. This workspace can show: ${blockTypes.join(', ')}. Lead with the composer; use what they have. Pair short blocks (composer, status, contact, help_search) with each other and lists (ideas, updates, roadmap, help_topics) with each other. No links block.

Presets set the starting layout: ${DESIGN_PRESETS.map((preset) => `${preset.id} (${preset.description})`).join('; ')}.
Colours are hex such as #0f766e.

Example look: ${JSON.stringify(DIRECTIONS_EXAMPLE)}`
}
