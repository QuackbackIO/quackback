/**
 * The names Appearance gives design fields, shared by its review list, Quackback
 * AI's change cards and approval requests.
 */
const COLOURS: Record<string, string> = {
  accent: 'Accent',
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
  'brand.fonts.headingWeight': 'Heading weight',
  'shape.corners': 'Corners',
  'shape.buttons': 'Buttons',
  'brand.light.support': 'Second colour',
  'brand.dark.support': 'Dark second colour',
  'brand.fonts.scale': 'Headline size',
  'brand.fonts.tracking': 'Headline spacing',
  'brand.fonts.headlineCase': 'Headline capitals',
  'brand.fonts.labelCase': 'Menu and button capitals',
  'brand.logoColours': 'Logo colours',
  'brand.logo.tone': 'Wordmark ink',
  'brand.logo.nameColour': 'Name colour',
  'brand.logo.nameCase': 'Name capitals',
  'brand.logo.nameAccent': 'Name part in colour',
  'brand.fonts.headlineColour': 'Headline colour',
  'shape.action': 'Band button colour',
  'layout.tint': 'Second colour tint',
  'layout.bandArt': 'Band art',
  'layout.imageFocus': 'Band image focus',
  'layout.blend': 'Blend',
  'layout.bandAlign': 'Band words',
  'layout.bandShape': 'Band shape',
  'layout.headerOnBand': 'Header on the band',
  'layout.imagePlace': 'Band image placement',
  'layout.status': 'Status markers',
  'pages.home.composer': 'Home composer',
  'pages.feedback.headline.accent': 'Headline phrase',
  'pages.home.headline.accent': 'Home headline phrase',
  'layout.header': 'Header',
  'layout.nav': 'Menu style',
  'layout.band': 'Top band',
  'layout.cards': 'Cards',
  'layout.density': 'Density',
  'layout.width': 'Page width',
  'layout.filters': 'Filters side',
  'pages.feedback.defaultSort': 'Default sort',
  'brand.logo.display': 'Logo display',
  'nav.home.on': 'Home page',
  'nav.home.tab': 'Home in the menu',
  'nav.home.label': 'Home tab name',
  'nav.items': 'Menu',
  'vocabulary.post': 'What people post',
  'vocabulary.board': 'What groups them',
  css: 'Custom CSS',
  'pages.feedback.copy': 'Own wording',
  'pages.feedback.welcome': 'Welcome message',
  'pages.home': 'Home',
  'nav.home': 'Home page',
  nav: 'Menu',
  vocabulary: 'Words',
  layout: 'Layout',
  shape: 'Corners',
  brand: 'Brand',
  'pages.home.blocks': 'Home blocks',
  'layout.pageTitles': 'Page titles',
  'pages.titles.roadmap': 'Roadmap title',
  'pages.titles.changelog': 'Changelog title',
  'pages.titles.help': 'Help Center title',
  'pages.titles.support': 'Support title',
  'pages.titles': 'Page titles',
}

const COPY_LABELS: Record<string, string> = {
  prompt: 'Composer prompt',
  submit: 'Submit button',
  emptyTitle: 'Empty feed title',
}

const IMAGES: Record<string, string> = {
  'brand.logo.mark.light': 'Logo',
  'brand.logo.mark.dark': 'Dark logo',
  'brand.logo.wordmark.light': 'Wordmark',
  'brand.logo.wordmark.dark': 'Dark wordmark',
  'brand.favicon': 'Favicon',
  'brand.shareImage': 'Share image',
  'brand.bandImage': 'Band image',
}

const IMAGE_PATH =
  /^(brand\.(?:logo\.(?:mark|wordmark)\.(?:light|dark)|favicon|shareImage|bandImage))(?:\.|$)/

/** Whether a path holds an uploaded image, whose value is a storage key no one should read. */
export function isImageField(path: string): boolean {
  return IMAGE_PATH.test(path)
}

/** A change's name as the Appearance controls call it. */
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
  // A field inside a list or a part takes the name of the nearest one named.
  for (let field = path; field; field = field.slice(0, Math.max(field.lastIndexOf('.'), 0)))
    if (LABELS[field]) return LABELS[field]
  return path
}
