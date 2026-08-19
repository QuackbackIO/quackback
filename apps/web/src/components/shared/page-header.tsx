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
        animate && 'animate-in fade-in duration-200 fill-mode-backwards motion-reduce:animate-none',
        className
      )}
    >
      <div className="flex items-center gap-2.5">
        {Icon && (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
        )}
        <div>
          <h1
            className={cn(
              'text-foreground',
              size === 'large'
                ? 'text-xl sm:text-2xl font-bold'
                : 'text-base sm:text-lg font-semibold'
            )}
          >
            {title}
          </h1>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}
