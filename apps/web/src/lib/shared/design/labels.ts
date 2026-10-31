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
}

/** A change's name as the Appearance controls call it. */
export function changeLabel(path: string): string {
  const colour = path.match(/^brand\.(light|dark)\.(\w+)$/)
  if (colour) {
    const name = COLOURS[colour[2]] ?? colour[2]
    return colour[1] === 'dark' ? `Dark ${name.toLowerCase()}` : name
  }
  if (path.startsWith('pages.feedback.welcome.body')) return 'Welcome message text'
  if (path === 'pages.feedback.welcome.show') return 'Welcome message'
  const headline = path.match(/^pages\.feedback\.headline(?:\.(title|subtitle))?/)
  if (headline) return headline[1] === 'subtitle' ? 'Subtitle' : 'Headline'
  const font = path.match(/^(brand\.fonts\.(?:heading|body))\./)
  return LABELS[font ? font[1] : path] ?? path
}
