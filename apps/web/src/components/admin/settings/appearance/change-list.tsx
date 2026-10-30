import type { DesignChange } from '@/lib/shared/design/diff'
import { BUNDLED_FONTS, type BundledFontId } from '@/lib/shared/design/fonts'

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

function ChangeValue({ value }: { value: unknown }) {
  if (value === undefined || value === null)
    return <span className="text-muted-foreground">Automatic</span>
  if (typeof value === 'string' && Object.hasOwn(BUNDLED_FONTS, value)) {
    return <span>{BUNDLED_FONTS[value as BundledFontId].label}</span>
  }
  if (typeof value === 'string' && /^(#|oklch\()/.test(value)) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-3 rounded-sm border border-border"
          style={{ background: value }}
        />
        <span className="font-mono text-xs">{value}</span>
      </span>
    )
  }
  if (typeof value === 'string') return <span>{VALUE_LABELS[value] ?? capital(value)}</span>
  return <span>{typeof value === 'object' ? 'Changed' : String(value)}</span>
}

/** Values the tiles name differently from the document. */
const VALUE_LABELS: Record<string, string> = {
  end: 'Right',
  start: 'Left',
  auto: 'Visitor chooses',
  centered: 'Centred',
  mark_and_name: 'Logo and name',
}

const capital = (value: string) => value[0].toUpperCase() + value.slice(1).replaceAll('_', ' ')

/** Every change a draft makes, with its value now and in the draft. */
export function ChangeList({ changes }: { changes: DesignChange[] }) {
  // A font change shows once, not once per field of the font.
  const shown = changes.filter(
    (change, index) =>
      changes.findIndex((other) => changeLabel(other.path) === changeLabel(change.path)) === index
  )
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {shown.map((change) => (
        <li key={change.path} className="flex items-center gap-3 px-3 py-2 text-[13px]">
          <span className="w-36 shrink-0 font-medium">{changeLabel(change.path)}</span>
          <ChangeValue value={change.before} />
          <span aria-hidden="true" className="text-muted-foreground">
            →
          </span>
          <ChangeValue value={change.after} />
        </li>
      ))}
    </ul>
  )
}
