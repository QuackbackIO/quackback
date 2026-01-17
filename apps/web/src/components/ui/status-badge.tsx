import type { ReactElement } from 'react'

import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  name: string
  color?: string | null
  className?: string
}

/**
 * Status indicator displaying a colored dot with text and subtle background.
 * Falls back to muted styling when no color is provided.
 */
export function StatusBadge({ name, color, className }: StatusBadgeProps): ReactElement {
  const colorStyles = color
    ? { backgroundColor: `color-mix(in oklch, ${color} 8%, transparent)`, color }
    : undefined

  const dotStyles = color ? { backgroundColor: color } : undefined

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        !color && 'bg-muted/40 text-muted-foreground',
        className
      )}
      style={colorStyles}
    >
      <span
        className={cn('size-1.5 shrink-0 rounded-full', !color && 'bg-muted-foreground')}
        style={dotStyles}
        aria-hidden="true"
      />
      {name}
    </span>
  )
}
