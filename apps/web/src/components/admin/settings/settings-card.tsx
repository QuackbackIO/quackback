import { cn } from '@/lib/shared/utils'

interface SettingsCardProps {
  title?: string
  description?: string
  action?: React.ReactNode
  variant?: 'default' | 'danger'
  /** A body without padding, for a `SettingsList` whose rows carry the card's horizontal padding. */
  flush?: boolean
  contentClassName?: string
  children: React.ReactNode
}

export function SettingsCard({
  title,
  description,
  action,
  variant = 'default',
  flush = false,
  contentClassName,
  children,
}: SettingsCardProps): React.ReactElement {
  return (
    <section
      data-settings-card=""
      data-variant={variant}
      className={cn(
        'overflow-hidden rounded-panel border bg-card',
        variant === 'danger' ? 'border-destructive/40' : 'border-border'
      )}
    >
      {(title || description || action) && (
        <div
          className={cn(
            'flex flex-wrap justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4 border-b border-border/50',
            description ? 'items-start' : 'items-center'
          )}
        >
          <div>
            {title && (
              <h2
                className={cn(
                  'text-base font-semibold',
                  variant === 'danger' && 'text-destructive'
                )}
              >
                {title}
              </h2>
            )}
            {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={cn(!flush && 'p-4 sm:p-6', contentClassName)}>{children}</div>
    </section>
  )
}
