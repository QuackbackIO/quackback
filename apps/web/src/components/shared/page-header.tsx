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
        animate && 'animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards',
        className
      )}
    >
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        )}
        <div>
          <h1
            className={cn(
              'text-foreground',
              size === 'large' ? 'text-3xl font-bold' : 'text-xl font-semibold'
            )}
          >
            {title}
          </h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}
