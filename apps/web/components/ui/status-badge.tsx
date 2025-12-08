import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  name: string
  color?: string | null
  className?: string
}

const DEFAULT_COLOR = '#6b7280'

/**
 * Status indicator component displaying a colored circle with text.
 */
export function StatusBadge({ name, color, className }: StatusBadgeProps) {
  const statusColor = color || DEFAULT_COLOR

  return (
    <div className={cn('inline-flex items-center gap-1.5 text-xs font-medium', className)}>
      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: statusColor }} />
      <span className="text-foreground">{name}</span>
    </div>
  )
}
