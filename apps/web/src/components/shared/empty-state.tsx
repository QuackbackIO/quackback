import type { ComponentType } from 'react'
import { cn } from '@/lib/shared/utils'

interface EmptyStateProps {
  icon: ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
  /** `compact` is for empty lists inside cards. */
  size?: 'default' | 'compact'
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = 'default',
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
          'rounded-full bg-muted flex items-center justify-center',
          compact ? 'size-10 mb-3' : 'h-12 w-12 mb-4'
        )}
      >
        <Icon className={cn('text-muted-foreground', compact ? 'size-5' : 'h-6 w-6')} />
      </div>
      <h3 className={compact ? 'text-[15px] font-semibold' : 'text-lg font-medium mb-1'}>
        {title}
      </h3>
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
