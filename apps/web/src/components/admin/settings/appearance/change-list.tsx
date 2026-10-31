import type { DesignChange } from '@/lib/shared/design/diff'
import { changeLabel } from '@/lib/shared/design/labels'
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
