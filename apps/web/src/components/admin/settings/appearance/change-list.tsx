import type { DesignChange } from '@/lib/shared/design/diff'
import {
  changeGroup,
  changeGroupOrder,
  changeLabel,
  isImageField,
  languageName,
} from '@/lib/shared/design/labels'
import { docText } from '@/lib/shared/design/apply-changes'
import { BUNDLED_FONTS, type BundledFontId } from '@/lib/shared/design/fonts'
import { BACKGROUND_NAMES, BACKGROUND_PAGE_NAMES } from '@/lib/shared/design/page-background'

export { changeLabel } from '@/lib/shared/design/labels'

/** A design value as the tiles name it: a font's name, a colour swatch, Automatic. */
export function ChangeValue({ value }: { value: unknown }) {
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
  return <span>{valueWords(value)}</span>
}

/** A design value in words, as the tiles name it; a colour by its code. */
export function valueWords(value: unknown): string {
  if (value === undefined || value === null) return 'Automatic'
  if (typeof value === 'string' && Object.hasOwn(BUNDLED_FONTS, value))
    return BUNDLED_FONTS[value as BundledFontId].label
  if (typeof value === 'string') return VALUE_LABELS[value] ?? (value ? capital(value) : 'None')
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  const background = backgroundWords(value)
  if (background) return background
  return typeof value === 'object' ? 'Changed' : String(value)
}

/** A page background, or the pages with their own, in words: "Gradient", "Roadmap: Pattern". */
function backgroundWords(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const kindOf = (v: unknown) => {
    const kind = (v as { kind?: unknown })?.kind
    return typeof kind === 'string' && Object.hasOwn(BACKGROUND_NAMES, kind)
      ? BACKGROUND_NAMES[kind as keyof typeof BACKGROUND_NAMES]
      : null
  }
  const own = kindOf(value)
  if (own) return own
  const pages = Object.entries(value)
  if (
    !pages.length ||
    !pages.every(([page, v]) => Object.hasOwn(BACKGROUND_PAGE_NAMES, page) && kindOf(v))
  )
    return null
  return pages
    .map(
      ([page, v]) =>
        `${BACKGROUND_PAGE_NAMES[page as keyof typeof BACKGROUND_PAGE_NAMES]}: ${kindOf(v)}`
    )
    .join(', ')
}

/** Values the tiles name differently from the document. */
const VALUE_LABELS: Record<string, string> = {
  end: 'Right',
  start: 'Left',
  auto: 'Visitor chooses',
  centered: 'Centred',
  mark_and_name: 'Logo and name',
  ink: 'Text colour',
  accent: 'Brand colour',
  support: 'Second colour',
  // Home's composer and the page titles keep the hero's old stored word: people see "hero".
  band: 'In the hero',
}

const capital = (value: string) => value[0].toUpperCase() + value.slice(1).replaceAll('_', ' ')

/**
 * An image reads as uploaded or not, its storage key meaning nothing to a
 * person; an empty headline as none; the menu and Home's blocks as how many
 * there are; an exact value with its unit.
 */
export function shownValue(path: string, value: unknown): unknown {
  const unit = /^tune\.\w+\.(size|radius|height|border)$/.test(path)
    ? 'px'
    : /^tune\.\w+\.tracking$/.test(path)
      ? 'em'
      : null
  if (unit && typeof value === 'number') return `${value} ${unit}`
  if (isImageField(path)) return value ? 'Uploaded image' : 'None'
  // Text left empty is none, not chosen for the person.
  if (/^pages\.\w+\.headline/.test(path) && value == null) return 'None'
  if (path === 'css')
    return typeof value === 'string' && value.trim()
      ? `${value.trim().split('\n').length} line${value.trim().includes('\n') ? 's' : ''}`
      : 'None'
  if (path === 'nav.items' && Array.isArray(value))
    return `${value.filter((item) => item.type === 'link' || item.shown).length} shown`
  if (path === 'pages.home.blocks' && Array.isArray(value))
    return value.length === 0
      ? 'No blocks'
      : `${value.length} block${value.length === 1 ? '' : 's'}`
  if (path === 'layout.background' || path.startsWith('layout.background.'))
    return value == null ? 'Page colour' : (backgroundWords(value) ?? plainValue(value))
  if (path === 'layout.pageBackgrounds' || path.startsWith('layout.pageBackgrounds.'))
    return value == null ? 'None' : (backgroundWords(value) ?? plainValue(value))
  return plainValue(value)
}

/** A language's key in a field of words by language: en, de, pt-BR. */
const LOCALE_KEY = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/

/** An object value as one short line: a font by its name, text by its English or its words. */
function plainValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  if (record.kind === 'bundled') return record.id
  if (record.kind === 'uploaded') return record.family
  if (record.type === 'doc') {
    const text = docText(record)
    return text.length > 60 ? `${text.slice(0, 57)}…` : text || 'None'
  }
  if (typeof record.en === 'string') return record.en
  // Words in another language say which. Only a map keyed by languages is words: a style's
  // { background: "#12893c" } is not "#12893c (background)".
  const entries = Object.entries(record)
  if (!entries.length || !entries.every(([key]) => LOCALE_KEY.test(key))) return value
  const [locale, text] = entries.find(([, words]) => typeof words === 'string') ?? []
  if (locale && typeof text === 'string') return `${text} (${languageName(locale)})`
  return value
}

/**
 * A font slot's name on one side of the changes: a bundled font's id or an
 * uploaded family's name, whichever that side has.
 */
function fontName(changes: DesignChange[], slot: string, side: 'before' | 'after'): unknown {
  return changes.find(
    (change) =>
      /\.(id|family)$/.test(change.path) &&
      change.path.startsWith(`${slot}.`) &&
      change[side] != null
  )?.[side]
}

/** Every change a draft makes, with its value now and in the draft. */
export function ChangeList({ changes }: { changes: DesignChange[] }) {
  // A font change shows once, not once per field of the font.
  const shown = changes.filter(
    (change, index) =>
      changes.findIndex((other) => changeLabel(other.path) === changeLabel(change.path)) === index
  )
  // Grouped by the part of the portal each change is in, in the order the parts show.
  const groups = [...new Set(shown.map((change) => changeGroup(change.path)))].sort(
    (a, b) => changeGroupOrder(a) - changeGroupOrder(b)
  )
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <section key={group} aria-label={group} className="space-y-1">
          <h4 className="text-xs font-medium text-muted-foreground">{group}</h4>
          <ChangeRows
            changes={changes}
            shown={shown.filter((change) => changeGroup(change.path) === group)}
          />
        </section>
      ))}
    </div>
  )
}

function ChangeRows({ changes, shown }: { changes: DesignChange[]; shown: DesignChange[] }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {shown.map((change) => {
        // A font names itself, however many of its fields changed.
        const slot = /^brand\.fonts\.(heading|body)\./.exec(change.path)?.[0].slice(0, -1)
        const side = (which: 'before' | 'after') =>
          (slot && fontName(changes, slot, which)) ?? shownValue(change.path, change[which])
        return (
          <li
            key={change.path}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-ui"
          >
            <span className="w-40 shrink-0">{changeLabel(change.path)}</span>
            <ChangeValue value={side('before')} />
            <span aria-hidden="true" className="text-muted-foreground">
              →
            </span>
            <ChangeValue value={side('after')} />
          </li>
        )
      })}
    </ul>
  )
}
