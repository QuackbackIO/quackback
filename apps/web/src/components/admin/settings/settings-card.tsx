import { cn } from '@/lib/utils'

interface SettingsCardProps {
  title: string
  description?: string
  action?: React.ReactNode
  variant?: 'default' | 'danger'
  contentClassName?: string
  children: React.ReactNode
}

export function SettingsCard({
  title,
  description,
  action,
  variant = 'default',
  contentClassName,
  children,
}: SettingsCardProps): React.ReactElement {
  return (
    <section
      className={cn(
        'rounded-xl border bg-card shadow-sm overflow-hidden',
        variant === 'danger' ? 'border-destructive/20' : 'border-border/50'
      )}
    >
      <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
        <div>
          <h2 className={cn('text-base font-semibold', variant === 'danger' && 'text-destructive')}>
            {title}
          </h2>
          {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      <div className={cn('p-6', contentClassName)}>{children}</div>
    </section>
  )
}
