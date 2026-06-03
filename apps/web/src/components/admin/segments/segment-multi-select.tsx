import { cn } from '@/lib/shared/utils'

export interface SegmentItem {
  id: string
  name: string
  memberCount?: number
}

interface SegmentMultiSelectProps {
  segments: SegmentItem[]
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  /** ARIA label override — defaults to "Segment allowlist". */
  ariaLabel?: string
}

/**
 * Inline multi-select for segments — rendered as a list of checkboxes
 * with segment names and optional member counts.
 *
 * Shared between any surface that grants access to a set of segments
 * (today: portal-access tab, per-board access form). The component is
 * purely presentational — segment fetching is the caller's job so each
 * surface can pick its own loading / empty / error UX.
 */
export function SegmentMultiSelect({
  segments,
  value,
  onChange,
  disabled,
  ariaLabel = 'Segment allowlist',
}: SegmentMultiSelectProps) {
  const selected = new Set(value)

  function toggle(id: string) {
    if (disabled) return
    const next = selected.has(id) ? value.filter((s) => s !== id) : [...value, id]
    onChange(next)
  }

  return (
    <ul className="space-y-1.5" role="list" aria-label={ariaLabel}>
      {segments.map((seg) => {
        const checked = selected.has(seg.id)
        return (
          <li key={seg.id}>
            <label
              className={cn(
                'flex items-center gap-2.5 rounded-md border px-3 py-2 cursor-pointer transition-colors',
                checked
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-border/50 bg-muted/20 hover:bg-muted/40',
                disabled && 'cursor-not-allowed opacity-60'
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(seg.id)}
                disabled={disabled}
                className="h-3.5 w-3.5 rounded border-border accent-primary"
              />
              <span className="flex-1 text-sm">{seg.name}</span>
              {seg.memberCount !== undefined && (
                <span className="text-xs text-muted-foreground">
                  {seg.memberCount} member{seg.memberCount === 1 ? '' : 's'}
                </span>
              )}
            </label>
          </li>
        )
      })}
    </ul>
  )
}
