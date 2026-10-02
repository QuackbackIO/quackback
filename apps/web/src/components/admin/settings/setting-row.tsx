import { Label } from '@/components/ui/label'
import { cn } from '@/lib/shared/utils'

interface SettingRowProps {
  label: React.ReactNode
  /** One line of 13px helper text under the label. */
  description?: React.ReactNode
  /** The switch, select or button on the right. */
  control: React.ReactNode
  /** Id of the control; clicking the label activates it. */
  htmlFor?: string
  /** A StateBadge or similar, shown beside the label. */
  badge?: React.ReactNode
  disabled?: boolean
  className?: string
}

/** One setting: label and optional description on the left, control on the right. */
export function SettingRow({
  label,
  description,
  control,
  htmlFor,
  badge,
  disabled,
  className,
}: SettingRowProps) {
  return (
    <div
      data-slot="setting-row"
      data-disabled={disabled ? 'true' : undefined}
      className={cn('flex items-center justify-between gap-6 py-3.5', className)}
    >
      <div className={cn('min-w-0', disabled && 'opacity-60')}>
        <div className="flex items-center gap-2">
          <Label htmlFor={htmlFor} className="text-sm font-medium leading-snug">
            {label}
          </Label>
          {badge}
        </div>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      <div data-slot="setting-row-control" className="flex shrink-0 items-center gap-2">
        {control}
      </div>
    </div>
  )
}

/** Stacks SettingRows with hairline dividers, flush with the card padding above and below. */
export function SettingRows({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="setting-rows"
      className={cn(
        'divide-y divide-border/50 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0',
        className
      )}
    >
      {children}
    </div>
  )
}
