import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  name: string
  color?: string | null
  className?: string
}

/**
 * Status indicator component displaying a colored circle with text.
 * Falls back to muted-foreground color if no color is provided.
 */
export function StatusBadge({ name, color, className }: StatusBadgeProps) {
  return (
    <div className={cn('inline-flex items-center gap-1.5 text-xs font-medium', className)}>
      <span
        className={cn('h-2 w-2 rounded-full shrink-0', !color && 'bg-muted-foreground')}
        style={color ? { backgroundColor: color } : undefined}
        aria-hidden="true"
      />
      <span className="text-foreground">{name}</span>
    </div>
  )
}
