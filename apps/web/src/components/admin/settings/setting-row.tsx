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
  /**
   * Put the label over the control below sm, for a control too wide to sit
   * beside its label on a phone (an address picker). The control then takes
   * the row's width.
   */
  stackOnPhone?: boolean
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
  stackOnPhone,
  className,
}: SettingRowProps) {
  // A plain label: the shared Label's disabled styles key off a `peer` or
  // `group` this row never has (the row dims itself), and every byte here is
  // repeated on every row of every settings page.
  const rowLabel = (
    <label
      data-slot="label"
      htmlFor={htmlFor}
      className="inline-flex items-center gap-2 select-none text-sm font-medium leading-snug"
    >
      {label}
    </label>
  )
  return (
    <div
      data-slot="setting-row"
      data-disabled={disabled ? 'true' : undefined}
      className={cn(
        'flex justify-between py-3.5',
        stackOnPhone ? 'flex-col gap-2 sm:flex-row sm:items-center sm:gap-6' : 'items-center gap-6',
        className
      )}
    >
      <div className={cn('min-w-0', disabled && 'opacity-60')}>
        {badge ? (
          <div className="flex items-center gap-2">
            {rowLabel}
            {badge}
          </div>
        ) : (
          rowLabel
        )}
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
