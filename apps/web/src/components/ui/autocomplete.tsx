import { useState } from 'react'
import { ChevronUpDownIcon, CheckIcon } from '@heroicons/react/24/solid'
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

export interface AutocompleteSuggestion {
  value: string
  label?: string
  description?: string
}

interface AutocompleteProps {
  value: string
  onValueChange: (value: string) => void
  suggestions: AutocompleteSuggestion[]
  placeholder?: string
  searchPlaceholder?: string
  ariaLabel?: string
  /** Shown in the list when there are no suggestions (e.g. no test sign-in yet). */
  emptyHint?: string
  disabled?: boolean
  size?: 'default' | 'sm'
  className?: string
}

/**
 * Creatable single-value autocomplete: pick a suggestion OR commit free text.
 * Built on Popover + cmdk Command so it matches the app's Combobox, but unlike
 * Combobox the committed value is an arbitrary string, not constrained to the
 * option list. The "Use ..." item commits whatever the admin typed.
 */
export function Autocomplete({
  value,
  onValueChange,
  suggestions,
  placeholder,
  searchPlaceholder,
  ariaLabel,
  emptyHint,
  disabled,
  size = 'default',
  className,
}: AutocompleteProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const commit = (v: string) => {
    onValueChange(v)
    setQuery('')
    setOpen(false)
  }

  const trimmed = query.trim()
  const exactMatch = suggestions.some((s) => s.value.toLowerCase() === trimmed.toLowerCase())
  const showCreate = trimmed.length > 0 && !exactMatch

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQuery('')
      }}
    >
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
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value || placeholder || 'Select…'}
          </span>
          <ChevronUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        {open && (
          <Command>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={searchPlaceholder ?? 'Search or type…'}
            />
            <CommandList>
              <CommandEmpty>{emptyHint ?? 'No matches.'}</CommandEmpty>
              {showCreate && (
                <CommandGroup>
                  <CommandItem value={trimmed} onSelect={() => commit(trimmed)}>
                    <span>{`Use "${trimmed}"`}</span>
                  </CommandItem>
                </CommandGroup>
              )}
              {suggestions.length > 0 && (
                <CommandGroup>
                  {suggestions.map((s) => (
                    <CommandItem
                      key={s.value}
                      value={`${s.value} ${s.label ?? ''} ${s.description ?? ''}`}
                      onSelect={() => commit(s.value)}
                    >
                      <CheckIcon
                        className={cn(
                          'mr-2 h-4 w-4',
                          s.value === value ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate">{s.label ?? s.value}</span>
                        {s.description && (
                          <span className="truncate text-xs text-muted-foreground">
                            {s.description}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}
