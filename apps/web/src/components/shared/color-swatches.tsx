import { cn } from '@/lib/shared/utils'

// The palette offered when picking a label or team color. The first entry is the
// service-side default, so "no choice" matches what the server would pick anyway.
export const TAG_COLORS = [
  '#6b7280',
  '#ef4444',
  '#f59e0b',
  '#eab308',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const
export const DEFAULT_TAG_COLOR = TAG_COLORS[0]

/** A compact swatch row for picking a color from the shared palette. */
export function ColorSwatches({
  value,
  onChange,
}: {
  value: string
  onChange: (color: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Color ${c}`}
          onClick={() => onChange(c)}
          className={cn(
            'h-4 w-4 rounded-full ring-offset-1 ring-offset-background transition',
            value.toLowerCase() === c.toLowerCase()
              ? 'ring-2 ring-foreground/60'
              : 'hover:scale-110'
          )}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  )
}
