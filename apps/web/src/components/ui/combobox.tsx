import { useState } from 'react'
import { ChevronUpDownIcon, CheckIcon } from '@heroicons/react/24/solid'
import { useIntl } from 'react-intl'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/shared/utils'

export interface ComboboxOption<T extends string> {
  value: T
  label: string
  /** Optional secondary line shown below the label (e.g. roadmap descriptions) */
  description?: string
}

interface ComboboxProps<T extends string> {
  value: T
  onValueChange: (value: T) => void
  options: ComboboxOption<T>[]
  placeholder?: string
  searchPlaceholder?: string
  /** Hide the search input when there are <= this many options. Default: 6 */
  hideSearchBelow?: number
  /** Aria label for the trigger when no value is selected */
  ariaLabel?: string
  className?: string
  size?: 'default' | 'sm'
  /** Width of the popover content; defaults to match the trigger */
  contentClassName?: string
  disabled?: boolean
}

/**
 * Searchable single-select built on Popover + cmdk Command. Drop-in
 * replacement for a native <select> when the option list is long enough
 * to benefit from filtering. Keyboard nav (↑/↓/Enter/Esc) comes from cmdk.
 */
export function Combobox<T extends string>({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  hideSearchBelow = 6,
  ariaLabel,
  className,
  size = 'default',
  contentClassName,
  disabled,
}: ComboboxProps<T>) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)

  const showSearch = options.length > hideSearchBelow

  const fallbackPlaceholder = intl.formatMessage({
    id: 'ui.combobox.placeholder',
    defaultMessage: 'Select…',
  })
  const fallbackSearchPlaceholder = intl.formatMessage({
    id: 'ui.combobox.search',
    defaultMessage: 'Search…',
  })
  const emptyMessage = intl.formatMessage({
    id: 'ui.combobox.empty',
    defaultMessage: 'No results found.',
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={size}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={disabled}
          className={cn('justify-between font-normal', className)}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected ? selected.label : (placeholder ?? fallbackPlaceholder)}
          </span>
          <ChevronUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn('w-(--radix-popover-trigger-width) p-0', contentClassName)}
      >
        {/* Remount Command on each open so the search input is empty. */}
        {open && (
          <Command>
            {showSearch && (
              <CommandInput placeholder={searchPlaceholder ?? fallbackSearchPlaceholder} />
            )}
            <CommandList>
              <CommandEmpty>{emptyMessage}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    // `value` is what cmdk filters on — include description so search hits it too
                    value={`${option.label} ${option.description ?? ''}`}
                    onSelect={() => {
                      onValueChange(option.value)
                      setOpen(false)
                    }}
                  >
                    <CheckIcon
                      className={cn(
                        'mr-2 h-4 w-4',
                        option.value === value ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="truncate">{option.label}</span>
                      {option.description && (
                        <span className="text-xs text-muted-foreground truncate">
                          {option.description}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}
