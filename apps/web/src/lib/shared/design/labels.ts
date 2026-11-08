import {
  STATE_INFO,
  STYLE_ELEMENTS,
  STYLE_PROPS,
  type ColourRoleName,
  type StyleProp,
  type StylePropInfo,
} from './style-tokens'

/**
 * The names Appearance gives design fields, shared by its review list, Quackback
 * AI's change cards and approval requests.
 */
const COLOURS: Record<string, string> = {
  accent: 'Brand colour',
  support: 'Second colour',
  extra: 'Extra colours',
  background: 'Background',
  ink: 'Text',
  surface: 'Cards',
  raised: 'Raised surfaces',
  muted: 'Secondary text',
  border: 'Borders',
}

const LABELS: Record<string, string> = {
  mode: 'Mode',
  'brand.fonts.heading': 'Heading font',
  'brand.fonts.body': 'Body font',
  'brand.fonts.display': 'Headline font',
  'brand.fonts.headingWeight': 'Heading weight',
  'shape.corners': 'Corners',
  'shape.buttons': 'Buttons',
  'shape.fill': 'Button colour',
  'shape.hover': 'Hover',
  'layout.menuAlign': 'Menu position',
  'brand.light.support': 'Second colour',
  'brand.dark.support': 'Dark second colour',
  'brand.light.extra': 'Extra colours',
  'brand.dark.extra': 'Dark extra colours',
  'layout.bandColour': 'Hero colour',
  'brand.fonts.scale': 'Headline size',
  'brand.fonts.tracking': 'Headline spacing',
  'brand.fonts.headlineCase': 'Headline capitals',
  'brand.fonts.labelCase': 'Menu and button capitals',
  'brand.logoColours': 'Logo colours',
  'brand.logo.tone': 'Logo ink',
  'brand.logo.oneInk': 'Logo in one ink',
  'brand.logo.ink': 'Logo colour',
  'brand.logo.name': 'Title',
  'brand.logo.height': 'Logo height',
  'brand.fonts.headlineColour': 'Headline colour',
  'shape.action': 'Hero call to action colour',
  'layout.tint': 'Second colour tint',
  'layout.bandArt': 'Hero art',
  'layout.background': 'Page background',
  'layout.pageBackgrounds': 'A page’s own background',
  'layout.imageFocus': 'Hero image focus',
  'layout.imagePoint': 'Hero image focal point',
  'layout.imagePhone': 'Hero image on phones',
  'layout.blend': 'Hero blend',
  'layout.bandAlign': 'Hero alignment',
  'layout.bandShape': 'Hero shape',
  'layout.bandHeight': 'Hero height',
  'layout.fadeFrom': 'Hero fade direction',
  'layout.bandGlow': 'Hero glow',
  'layout.bandGlowColour': 'Hero glow colour',
  'layout.headerOnBand': 'Header blends into the hero',
  'layout.imagePlace': 'Hero image placement',
  'layout.status': 'Status markers',
  'pages.home.composer': 'Home composer',
  'pages.home.composerWidth': 'Home composer width',
  'pages.home.mainAction': 'Home main action',
  'pages.home.button': 'Home call to action',
  'pages.feedback.headline.accent': 'Headline phrase',
  'pages.home.headline.accent': 'Home headline phrase',
  'layout.header': 'Header',
  'layout.nav': 'Menu style',
  'layout.navText': 'Menu text',
  'layout.band': 'Hero look',
  'layout.cards': 'Cards',
  'layout.density': 'Density',
  'layout.width': 'Page width',
  'layout.filters': 'Filters side',
  'pages.feedback.defaultSort': 'Default sort',
  'pages.feedback.openOn': 'Feed opens on',
  'brand.logo.display': 'Full logo image',
  'nav.home.on': 'Home page',
  'nav.home.tab': 'Home in the menu',
  'nav.home.label': 'Home tab name',
  'nav.items': 'Menu',
  css: 'Custom CSS',
  'pages.feedback.copy': 'Own wording',
  'pages.feedback.welcome': 'Welcome message',
  'pages.home': 'Home',
  'nav.home': 'Home page',
  nav: 'Menu',
  layout: 'Layout',
  shape: 'Corners',
  brand: 'Brand',
  'pages.home.blocks': 'Home blocks',
  'layout.pageTitles': 'Page titles',
  tune: 'Exact values',
  'tune.headline': 'Headline exact values',
  'tune.heading': 'Section heading exact values',
  'tune.label': 'Menu and button text exact values',
  'tune.button': 'Button exact values',
  'tune.card': 'Card exact values',
  'tune.field': 'Field exact values',
  'pages.titles.roadmap': 'Roadmap title',
  'pages.titles.changelog': 'Changelog title',
  'pages.titles.help': 'Help Center title',
  'pages.titles.support': 'Support title',
  'pages.titles': 'Page titles',
  'pages.changelog': 'Changelog page',
  'pages.changelog.entries': 'Changelog entries',
  'pages.changelog.images': 'Changelog images',
  'pages.changelog.subscribe': 'Subscribe button',
  'pages.help': 'Help Center page',
  'pages.help.topics': 'Help topics',
  'pages.help.popular': 'Popular articles',
  'pages.help.search': 'Help search size',
  'pages.roadmap': 'Roadmap page',
  'pages.roadmap.board': 'Roadmap board',
  'pages.roadmap.votes': 'Roadmap votes',
}

const COPY_LABELS: Record<string, string> = {
  prompt: 'Composer prompt',
  submit: 'Submit button',
  emptyTitle: 'Empty feed title',
}

const IMAGES: Record<string, string> = {
  'brand.logo.mark.light': 'Icon',
  'brand.logo.mark.dark': 'Icon on dark',
  'brand.logo.wordmark.light': 'Full logo',
  'brand.logo.wordmark.dark': 'Full logo on dark',
  'brand.favicon': 'Favicon',
  'brand.shareImage': 'Share image',
  'brand.bandImage': 'Hero image',
}

const IMAGE_PATH =
  /^(brand\.(?:logo\.(?:mark|wordmark)\.(?:light|dark)|favicon|shareImage|bandImage))(?:\.|$)/

/** Whether a path holds an uploaded image, whose value is a storage key no one should read. */
export function isImageField(path: string): boolean {
  return IMAGE_PATH.test(path)
}

/** A change's name as the Appearance controls call it. */
const TUNE_PARTS: Record<string, string> = {
  headline: 'Headline',
  heading: 'Section heading',
  label: 'Menu and button text',
  button: 'Button',
  card: 'Card',
  field: 'Field',
  subtitle: 'Subtitle',
  link: 'Link',
  secondary: 'Secondary button',
  body: 'Body text',
}
const TUNE_FIELDS: Record<string, string> = {
  size: 'size',
  weight: 'weight',
  tracking: 'letter spacing',
  leading: 'line height',
  colour: 'colour',
  radius: 'corners',
  height: 'height',
  fill: 'fill',
  ink: 'label colour',
  case: 'capitals',
  border: 'edge',
  shadow: 'shadow',
  titleSize: 'title size',
  titleWeight: 'title weight',
  underline: 'underline',
  style: 'style',
}

export function changeLabel(path: string): string {
  const image = path.match(IMAGE_PATH)
  if (image) return IMAGES[image[1]]
  const colour = path.match(/^brand\.(light|dark)\.(\w+)$/)
  if (colour) {
    const name = COLOURS[colour[2]] ?? colour[2]
    return colour[1] === 'dark' ? `Dark ${name.toLowerCase()}` : name
  }
  const copy = path.match(/^pages\.feedback\.copy\.(prompt|submit|emptyTitle)/)
  if (copy) return COPY_LABELS[copy[1]!]!
  if (path.startsWith('pages.feedback.welcome.body')) return 'Welcome message text'
  if (path === 'pages.feedback.welcome.show') return 'Welcome message'
  const headline = path.match(/^pages\.(feedback|home)\.headline(?:\.(title|subtitle))?/)
  if (headline) {
    const name = headline[2] === 'subtitle' ? 'Subtitle' : 'Headline'
    return headline[1] === 'home' ? `Home ${name.toLowerCase()}` : name
  }
  const font = path.match(/^(brand\.fonts\.(?:heading|body))\./)
  if (font) return LABELS[font[1]!]!
  // Each exact value on its own row, such as "Headline size".
  const tuned = path.match(/^tune\.(\w+)\.(\w+)$/)
  if (tuned && TUNE_PARTS[tuned[1]!] && TUNE_FIELDS[tuned[2]!])
    return `${TUNE_PARTS[tuned[1]!]} ${TUNE_FIELDS[tuned[2]!]}`
  // An element's style, such as "Main buttons, hover: background" (dark mode's own named so).
  const styled = path.match(/^(style|styleDark)\.(\w+)\.(\w+)\.(\w+)$/)
  const el = styled && (STYLE_ELEMENTS as Record<string, { label: string }>)[styled[2]!]
  const prop = styled && (STYLE_PROPS as Record<string, { label: string }>)[styled[4]!]
  const state = styled && STATE_INFO[styled[3] as keyof typeof STATE_INFO]
  if (styled && el && prop && state)
    return `${el.label}${styled[3] === 'base' ? '' : `, ${state.label.toLowerCase()}`}: ${prop.label.toLowerCase()}${styled[1] === 'styleDark' ? ' in dark mode' : ''}`
  if (path === 'style' || path.startsWith('style.')) return 'Element styles'
  if (path === 'styleDark' || path.startsWith('styleDark.')) return 'Dark element styles'
  // A field inside a list or a part takes the name of the nearest one named.
  for (let field = path; field; field = field.slice(0, Math.max(field.lastIndexOf('.'), 0)))
    if (LABELS[field]) return LABELS[field]
  return path
}

/** A language's name in English, such as German for de. */
export function languageName(locale: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale) ?? locale
  } catch {
    return locale
  }
}

/** A word field's label, naming its language when it is not English. */
export const inLanguage = (label: string, locale: string) =>
  locale === 'en' ? label : `${label} (${languageName(locale)})`

/** Fields that reach more than one part, and what else each changes. */
const ALSO_CHANGES: Record<string, string> = {
  'shape.corners': 'Also changes the corners of cards, fields and buttons.',
  'tune.label': 'Also changes the menu as well as buttons.',
  'brand.fonts.heading': 'Also changes the headline, unless it has its own font.',
  'brand.light.support': 'Also changes the hero, tints and the hero’s button.',
}

/** What else a change to a field reaches, when it reaches more than one part. */
export function alsoChanges(path: string): string | null {
  const shared = Object.keys(ALSO_CHANGES).find(
    (field) => path === field || path.startsWith(`${field}.`)
  )
  return shared ? ALSO_CHANGES[shared]! : null
}

/** The parts of the portal a review groups its changes under, in the order they show. */
const CHANGE_GROUPS: Array<[group: string, matches: RegExp]> = [
  ['Site styles', /^(mode|brand|shape|tune|layout\.(width|density|tint|cards|status|fill)|css)\b/],
  ['Header and menu', /^(layout\.(header|nav|headerOnBand)|nav)\b/],
  [
    'Hero',
    /^(layout\.(band|blend|bandAlign|bandShape|bandHeight|fadeFrom|bandGlow|bandGlowColour|bandArt|imagePlace|imageFocus|pageTitles)|pages\.(feedback|home)\.headline|pages\.titles)\b/,
  ],
  ['Home', /^pages\.home\b/],
  ['Feedback page', /^(pages\.feedback|layout\.(filters|postCardHides))\b/],
  ['Roadmap page', /^pages\.roadmap\b/],
  ['Changelog page', /^pages\.changelog\b/],
  ['Help Center page', /^pages\.help\b/],
]

/** The part of the portal a change belongs to, for grouping a review. */
export function changeGroup(path: string): string {
  return CHANGE_GROUPS.find(([, matches]) => matches.test(path))?.[0] ?? 'Other'
}

/** Where a group sits among the others, as the parts show on the page; Other last. */
export const changeGroupOrder = (group: string) => {
  const at = CHANGE_GROUPS.findIndex(([name]) => name === group)
  return at < 0 ? CHANGE_GROUPS.length : at
}

/** A colour role as a change card says it: "Brand", "Black". */
const ROLE_WORDS: Record<ColourRoleName, string> = {
  accent: 'Brand',
  support: 'Second colour',
  extra1: 'Extra colour 1',
  extra2: 'Extra colour 2',
  ink: 'Text colour',
  muted: 'Secondary text colour',
  page: 'Page colour',
  surface: 'Card colour',
  raised: 'Raised grey',
  border: 'Edge colour',
  'accent-text': 'Brand text colour',
  'on-accent': 'Text on brand',
  white: 'White',
  black: 'Black',
  transparent: 'None',
}

/** An element style's value in a few words: "Brand", "999px", "ALL CAPITALS", "Gradient". */
export function styleValueWords(prop: StyleProp, value: unknown): string {
  const info: StylePropInfo = STYLE_PROPS[prop]
  if (value && typeof value === 'object') return 'Gradient'
  if (info.kind === 'number' && typeof value === 'number') return `${value}${info.unit}`
  if (info.kind === 'choice')
    return (info.looks as Record<string, string>)[String(value)] ?? String(value)
  if (typeof value === 'string' && value in ROLE_WORDS) return ROLE_WORDS[value as ColourRoleName]
  // Black and white read as their names, however they are written.
  if (typeof value === 'string' && /^#(?:000|000000)$/i.test(value)) return 'Black'
  if (typeof value === 'string' && /^#(?:fff|ffffff)$/i.test(value)) return 'White'
  return String(value)
}
