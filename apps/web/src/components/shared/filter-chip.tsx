import { useState } from 'react'
import { XMarkIcon } from '@heroicons/react/24/solid'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/shared/utils'

export interface FilterOption {
  id: string
  label: string
  color?: string
}

interface FilterChipProps {
  /** Icon component to display (when no color is set) */
  icon: React.ComponentType<{ className?: string }>
  /** Filter label (e.g. "Status", "Board") */
  label: string
  /** Filter value display text */
  value: string
  /** Currently selected option ID (for highlighting in dropdown) */
  valueId: string
  /** Optional color for a dot indicator */
  color?: string
  /** Called when the chip's remove button is clicked */
  onRemove: () => void
  /** Called when a dropdown option is selected */
  onChange?: (newId: string) => void
  /** Dropdown options (renders a popover when provided with onChange) */
  options?: FilterOption[]
  /**
   * Marks the chip as an internal / team-only filter: amber-accented styling
   * plus (when `tooltip` is set) a hover tooltip. Customers never see these.
   */
  internal?: boolean
  /** Localized tooltip text; shown on hover when `internal` is set. */
  tooltip?: string
}

export function FilterChip({
  icon: Icon,
  label,
  value,
  valueId,
  color,
  onRemove,
  onChange,
  options,
  internal = false,
  tooltip,
}: FilterChipProps) {
  const [open, setOpen] = useState(false)
  const hasOptions = options && options.length > 0 && onChange

  const handleSelect = (id: string) => {
    onChange?.(id)
    setOpen(false)
  }

  const chipContent = (
    <>
      {color ? (
        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
      ) : (
        <Icon
          className={cn(
            'h-3 w-3',
            internal ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground'
          )}
          aria-hidden="true"
        />
      )}
      <span
        className={cn(internal ? 'text-amber-700 dark:text-amber-500' : 'text-muted-foreground')}
      >
        {label}
      </span>
      <span
        className={cn(
          'font-medium',
          internal ? 'text-amber-800 dark:text-amber-400' : 'text-foreground'
        )}
      >
        {value}
      </span>
    </>
  )

  const chip = (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5',
        'rounded-full text-[13px]',
        'transition-colors',
        internal
          ? 'bg-amber-500/10 border border-amber-500/40 hover:border-amber-500/60'
          : 'bg-muted/60 border border-border/30 hover:border-border/50'
      )}
    >
      {hasOptions ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 hover:opacity-70 transition-opacity"
            >
              {chipContent}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-44 p-0">
            <div className="max-h-[250px] overflow-y-auto py-1">
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleSelect(option.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2.5 py-1.5 text-[13px] transition-colors',
                    option.id === valueId ? 'bg-muted/50 font-medium' : 'hover:bg-muted/50'
                  )}
                >
                  {option.color && (
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: option.color }}
                    />
                  )}
                  {option.label}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <span className="inline-flex items-center gap-1">{chipContent}</span>
      )}
      <button
        type="button"
        onClick={onRemove}
        className={cn(
          'ml-0.5 p-0.5 rounded-full',
          'hover:bg-foreground/10',
          'text-muted-foreground hover:text-foreground',
          'transition-colors'
        )}
        aria-label={`Remove ${label} ${value} filter`}
      >
        <XMarkIcon className="h-2.5 w-2.5" />
      </button>
    </div>
  )

  if (internal && tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    )
  }

  return chip
}
