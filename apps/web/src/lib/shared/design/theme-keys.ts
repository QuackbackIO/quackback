/**
 * Theme: the brand-wide settings, each by a plain name, with what it does,
 * the values it takes and what each looks like, and the design field it
 * stores. Quackback AI sets them by name (setTheme); the field behind each
 * goes through the design's own checks, so a value is kept only when the
 * schema and the contrast solver accept it.
 */
import { BUNDLED_FONT_IDS, DESIGN_OPTIONS } from './options'
import { tuneSchema } from './tune'
import { stylePath } from './style-tokens'

export interface ThemeKey {
  /** The design field it stores. */
  path: string
  /** What it does, in a plain sentence. */
  about: string
  /** What its values are: a few named ones with their looks, or a kind of value. */
  values:
    | { kind: 'choice'; looks: Readonly<Record<string, string>> }
    | { kind: 'colour' }
    | { kind: 'font' }
    | { kind: 'text'; max: number }
    | { kind: 'list'; of: readonly string[] }
}

const choice = (looks: Record<string, string>) => ({ kind: 'choice' as const, looks })
const named = (values: readonly (string | number)[]) =>
  choice(Object.fromEntries(values.map((value) => [String(value), String(value)])))

export const THEME_KEYS = {
  mode: {
    path: 'mode',
    about: 'Light or dark pages',
    values: choice({
      light: 'light pages',
      dark: 'dark pages',
      auto: 'follows the visitor’s device',
    }),
  },
  accent: {
    path: 'brand.light.accent',
    about: 'The brand colour: buttons, links, the current menu item and a coloured hero',
    values: { kind: 'colour' },
  },
  support: {
    path: 'brand.light.support',
    about: 'A second brand colour, for heroes, tints and highlights; null removes it',
    values: { kind: 'colour' },
  },
  background: {
    path: 'brand.light.background',
    about: 'The page colour',
    values: { kind: 'colour' },
  },
  text: { path: 'brand.light.ink', about: 'The text colour', values: { kind: 'colour' } },
  surface: {
    path: 'brand.light.surface',
    about: 'The colour of cards; null works it out from the page',
    values: { kind: 'colour' },
  },
  muted: { path: 'brand.light.muted', about: 'Secondary text', values: { kind: 'colour' } },
  border: { path: 'brand.light.border', about: 'Edges and lines', values: { kind: 'colour' } },
  darkBackground: {
    path: 'brand.dark.background',
    about: 'The page colour in dark mode',
    values: { kind: 'colour' },
  },
  darkText: {
    path: 'brand.dark.ink',
    about: 'The text colour in dark mode',
    values: { kind: 'colour' },
  },
  headingFont: {
    path: 'brand.fonts.heading',
    about: 'The font of headings, and of headlines unless headlineFont is set',
    values: { kind: 'font' },
  },
  bodyFont: {
    path: 'brand.fonts.body',
    about: 'The font of all other text',
    values: { kind: 'font' },
  },
  headlineFont: {
    path: 'brand.fonts.display',
    about:
      'A face for page headlines alone, such as a condensed poster face; null uses headingFont',
    values: { kind: 'font' },
  },
  headingWeight: {
    path: 'brand.fonts.headingWeight',
    about: 'How heavy headings are',
    values: named(DESIGN_OPTIONS.headingWeight),
  },
  headlineSize: {
    path: 'brand.fonts.scale',
    about: 'How large page headlines are',
    values: choice({
      standard: 'the usual size',
      large: 'larger',
      display: 'very large, poster-like',
    }),
  },
  headlineSpacing: {
    path: 'brand.fonts.tracking',
    about: 'Headlines’ letter-spacing',
    values: choice({ normal: 'usual spacing', tight: 'letters set closer' }),
  },
  headlineCase: {
    path: 'brand.fonts.headlineCase',
    about: 'Headlines in sentence case or capitals',
    values: choice({ sentence: 'Sentence case', upper: 'ALL CAPITALS' }),
  },
  labelCase: {
    path: 'brand.fonts.labelCase',
    about: 'The menu and buttons in sentence case or capitals',
    values: choice({ sentence: 'Sentence case', upper: 'ALL CAPITALS' }),
  },
  headlineColour: {
    path: 'brand.fonts.headlineColour',
    about: 'Headlines in the text colour or the brand colour',
    values: choice({ ink: 'the text colour', accent: 'the brand colour' }),
  },
  corners: {
    path: 'shape.corners',
    about: 'How round cards, fields and buttons are; sharpest first',
    values: choice({
      sharp: 'square corners',
      subtle: 'slightly rounded',
      rounded: 'rounded',
      pill: 'fully round, the roundest',
    }),
  },
  buttons: {
    path: 'shape.buttons',
    about: 'Buttons’ own shape; match follows corners',
    values: choice({
      match: 'as the corners',
      square: 'square buttons',
      rounded: 'rounded buttons',
      pill: 'pill buttons',
    }),
  },
  buttonFill: {
    path: 'shape.fill',
    about: 'What fills primary buttons',
    values: choice({ accent: 'the brand colour', ink: 'the text colour, as black buttons' }),
  },
  header: {
    path: 'layout.header',
    about: 'How the header lays out the logo and menu',
    values: choice({
      stacked: 'the logo above the menu',
      inline: 'the logo and menu in one row',
      centered: 'the logo and menu centred',
    }),
  },
  menuStyle: {
    path: 'layout.nav',
    about: 'How the menu marks the current page',
    values: choice({
      tabs: 'tabs',
      underline: 'an underline',
      pills: 'a filled pill',
      plain: 'darker, heavier text alone',
    }),
  },
  menuText: {
    path: 'layout.navText',
    about: 'The colour of the menu’s other pages',
    values: choice({
      muted: 'a softer grey than the text',
      ink: 'the text colour, as most brands’ menus are',
    }),
  },
  cards: {
    path: 'layout.cards',
    about: 'How posts sit in the feed',
    values: choice({
      bordered: 'cards with an edge',
      raised: 'cards floating on a shadow, without an edge',
      list: 'rows divided by lines, no cards',
      filled: 'soft panels without an edge',
    }),
  },
  density: {
    path: 'layout.density',
    about: 'How much room the feed gives',
    values: choice({ compact: 'tight', comfortable: 'the usual room', spacious: 'more room' }),
  },
  width: {
    path: 'layout.width',
    about: 'How wide the page’s content is',
    values: choice({ narrow: 'narrow', default: 'the usual width', wide: 'wide' }),
  },
  filters: {
    path: 'layout.filters',
    about: 'Which side of the feed its filters sit on',
    values: choice({ end: 'on the right', start: 'on the left' }),
  },
  statusStyle: {
    path: 'layout.status',
    about: 'How post statuses are marked',
    values: choice({
      colour: 'coloured dots',
      ink: 'dots in the text colour',
      pill: 'tinted tags',
      brand: 'the logo’s colours',
    }),
  },
  tint: {
    path: 'layout.tint',
    about: 'What tints the vote box and the current menu item',
    values: choice({ neutral: 'a neutral grey', support: 'the second brand colour' }),
  },
  cardHides: {
    path: 'layout.postCardHides',
    about: 'What post cards leave out; an empty list shows everything',
    values: { kind: 'list', of: DESIGN_OPTIONS.postCardField },
  },
  logoTitle: {
    path: 'brand.logo.name',
    about: 'The title beside the logo icon; empty shows the workspace’s name',
    values: { kind: 'text', max: 60 },
  },
} as const satisfies Record<string, ThemeKey>

export type ThemeKeyName = keyof typeof THEME_KEYS

/** The parts an exact value refines, as `<part>.<field>`, such as headline.size. */
export const TUNE_PARTS = Object.keys(tuneSchema.shape) as Array<keyof typeof tuneSchema.shape>

/**
 * The design field a theme key stores: a named key's own, or an exact value
 * written as `<part>.<field>` (headline.size). Null for a key Theme does not have.
 */
export function themePath(key: string): string | null {
  if (Object.hasOwn(THEME_KEYS, key)) return THEME_KEYS[key as ThemeKeyName].path
  // An element's look in a state: style.button.hover.background (style-tokens.ts).
  if (/^style(Dark)?\./.test(key)) return stylePath(key)
  const tuned = /^(?:tune\.)?(\w+)\.(\w+)$/.exec(key)
  if (tuned && (TUNE_PARTS as string[]).includes(tuned[1]!)) {
    const part = tuneSchema.shape[tuned[1] as keyof typeof tuneSchema.shape].unwrap()
    if (Object.hasOwn(part.shape, tuned[2]!)) return `tune.${tuned[1]}.${tuned[2]}`
  }
  return null
}

/** The fonts a font key takes, by id. */
export const THEME_FONTS = BUNDLED_FONT_IDS
