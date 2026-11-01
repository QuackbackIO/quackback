import { createContext, useContext, type CSSProperties, type ReactElement } from 'react'

import { cn } from '@/lib/shared/utils'

/**
 * How a page shows status colours. The portal maps them into a design's own
 * colours; everywhere else they show as stored.
 */
export const StatusColourContext = createContext<(colour: string) => string>((colour) => colour)

/** A status colour as this page shows it. */
export function useStatusColour(colour: string | null | undefined): string | null | undefined {
  const shown = useContext(StatusColourContext)
  return colour ? shown(colour) : colour
}

interface StatusBadgeProps {
  name: string
  color?: string | null
  className?: string
}

/**
 * Status indicator displaying a colored dot with text.
 * Falls back to muted styling when no color is provided.
 */
export function StatusBadge({ name, color, className }: StatusBadgeProps): ReactElement {
  const shown = useStatusColour(color)
  // The colour is a variable the dot paints from, which a design's status style can override.
  const colour = shown ? ({ '--qb-status': shown } as CSSProperties) : undefined
  return (
    <span
      data-qb-part="status-badge"
      style={colour}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium text-foreground',
        !color && 'text-muted-foreground',
        className
      )}
    >
      <span
        data-qb-status-dot=""
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          shown ? 'bg-[var(--qb-status)]' : 'bg-muted-foreground'
        )}
        aria-hidden="true"
      />
      {name}
    </span>
  )
}

/** A status's or tag's dot on its own, in the colour this page shows it and the design's status style. */
export function StatusColourDot({
  colour,
  className,
}: {
  colour: string | null | undefined
  className?: string
}): ReactElement {
  const shown = useStatusColour(colour)
  return (
    <span
      data-qb-status-dot=""
      aria-hidden="true"
      className={cn(
        'shrink-0 rounded-full',
        shown ? 'bg-[var(--qb-status)]' : 'bg-muted-foreground',
        className
      )}
      style={shown ? ({ '--qb-status': shown } as CSSProperties) : undefined}
    />
  )
}
