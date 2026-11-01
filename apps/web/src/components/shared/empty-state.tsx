import type { ComponentType } from 'react'
import { cn } from '@/lib/shared/utils'

interface EmptyStateProps {
  icon: ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
  /** `compact` is for empty lists inside cards. */
  size?: 'default' | 'compact'
  /** Its title's level: one below the heading of what it sits in. */
  heading?: 'h2' | 'h3'
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = 'default',
  heading: Heading = 'h3',
  className,
}: EmptyStateProps) {
  const compact = size === 'compact'
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-4 text-center',
        compact ? 'py-9' : 'py-16',
        className
      )}
    >
      <div
        className={cn(
          'shrink-0 rounded-full bg-muted flex items-center justify-center',
          compact ? 'size-10 mb-3' : 'h-12 w-12 mb-4'
        )}
      >
        <Icon className={cn('text-muted-foreground', compact ? 'size-5' : 'h-6 w-6')} />
      </div>
      <Heading className={compact ? 'text-[15px] font-semibold' : 'text-lg font-medium mb-1'}>
        {title}
      </Heading>
      {description && (
        <p
          className={cn(
            'text-muted-foreground',
            compact ? 'mt-1 max-w-md text-[13px]' : 'max-w-sm text-sm'
          )}
        >
          {description}
        </p>
      )}
      {action && <div className={compact ? 'mt-3.5' : 'mt-4'}>{action}</div>}
    </div>
  )
}
