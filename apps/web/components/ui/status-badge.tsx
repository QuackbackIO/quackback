import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  name: string
  color?: string | null
  className?: string
}

const DEFAULT_COLOR = '#6b7280'

/**
 * Badge component for displaying post status with dynamic coloring.
 * Automatically generates background, text, and border colors from the status color.
 */
export function StatusBadge({ name, color, className }: StatusBadgeProps) {
  const statusColor = color || DEFAULT_COLOR

  return (
    <Badge
      variant="outline"
      className={cn('text-[11px] font-medium', className)}
      style={{
        backgroundColor: `${statusColor}15`,
        color: statusColor,
        borderColor: `${statusColor}40`,
      }}
    >
      {name}
    </Badge>
  )
}
