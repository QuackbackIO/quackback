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
  'pages.home.blocks': 'Home blocks',
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
}

const IMAGE_PATH =
  /^(brand\.(?:logo\.(?:mark|wordmark)\.(?:light|dark)|favicon|shareImage))(?:\.|$)/

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
  return LABELS[font ? font[1] : path] ?? path
}
