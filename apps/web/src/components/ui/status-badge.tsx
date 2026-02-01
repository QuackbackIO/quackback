import type { ReactElement } from 'react'

import { cn } from '@/lib/shared/utils'

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
  const dotStyles = color ? { backgroundColor: color } : undefined

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium text-foreground',
        !color && 'text-muted-foreground',
        className
      )}
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
