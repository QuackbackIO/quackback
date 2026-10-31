import type { DesignChange } from '@/lib/shared/design/diff'
import { changeLabel, isImageField } from '@/lib/shared/design/labels'
import { docText } from '@/lib/shared/design/apply-changes'
import { BUNDLED_FONTS, type BundledFontId } from '@/lib/shared/design/fonts'

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
  if (typeof value === 'string') return <span>{VALUE_LABELS[value] ?? capital(value)}</span>
  if (typeof value === 'boolean') return <span>{value ? 'On' : 'Off'}</span>
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

/**
 * An image reads as uploaded or not, its storage key meaning nothing to a
 * person; an empty headline as none; the menu and Home's blocks as how many
 * there are.
 */
export function shownValue(path: string, value: unknown): unknown {
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
  return plainValue(value)
}

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
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {shown.map((change) => {
        // A font names itself, however many of its fields changed.
        const slot = /^brand\.fonts\.(heading|body)\./.exec(change.path)?.[0].slice(0, -1)
        const side = (which: 'before' | 'after') =>
          (slot && fontName(changes, slot, which)) ?? shownValue(change.path, change[which])
        return (
          <li key={change.path} className="flex items-center gap-3 px-3 py-2 text-[13px]">
            <span className="w-36 shrink-0 font-medium">{changeLabel(change.path)}</span>
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
