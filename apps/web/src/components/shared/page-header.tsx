import type { ComponentType } from 'react'
import { cn } from '@/lib/shared/utils'

interface PageHeaderProps {
  icon?: ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
  size?: 'default' | 'large'
  animate?: boolean
  className?: string
}

export function PageHeader({
  icon: Icon,
  title,
  description,
  action,
  size = 'default',
  animate,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4',
        animate && 'animate-in fade-in duration-200 fill-mode-backwards',
        className
      )}
    >
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="flex h-8 w-8 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
          </div>
        )}
        <div>
          <h1
            className={cn(
              'text-foreground',
              size === 'large'
                ? 'text-2xl sm:text-3xl font-bold'
                : 'text-lg sm:text-xl font-semibold'
            )}
          >
            {title}
          </h1>
          {description && <p className="text-xs sm:text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}
