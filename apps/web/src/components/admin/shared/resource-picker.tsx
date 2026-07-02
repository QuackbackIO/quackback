/**
 * Generic searchable single/multi resource picker built on Popover + cmdk.
 *
 * Used by `<TeamPicker />`, `<InboxPicker />`, `<StatusPicker />`,
 * `<OrgPicker />`, `<ContactPicker />`. Keeps the network layer external —
 * the consumer wires its own query hook and passes the result rows in.
 */
import { useState, type ReactNode } from 'react'
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

export interface PickerOption<TId extends string> {
  id: TId
  label: string
  description?: string
  /** Optional leading visual (avatar / colour chip). */
  leading?: ReactNode
  /** Optional trailing badge (count / role label). */
  trailing?: ReactNode
}

interface BaseProps<TId extends string> {
  options: PickerOption<TId>[]
  isLoading?: boolean
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  className?: string
  onSearchChange?: (q: string) => void
}

interface SingleProps<TId extends string> extends BaseProps<TId> {
  multiple?: false
  value: TId | null
  onValueChange: (value: TId | null) => void
  allowClear?: boolean
  clearLabel?: string
}

interface MultiProps<TId extends string> extends BaseProps<TId> {
  multiple: true
  value: TId[]
  onValueChange: (value: TId[]) => void
}

export type ResourcePickerProps<TId extends string> = SingleProps<TId> | MultiProps<TId>

export function ResourcePicker<TId extends string>(props: ResourcePickerProps<TId>) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const optionsById = new Map(props.options.map((o) => [o.id, o]))

  function toggle(id: TId) {
    if (props.multiple) {
      const next = props.value.includes(id)
        ? props.value.filter((v) => v !== id)
        : [...props.value, id]
      props.onValueChange(next)
    } else {
      props.onValueChange(id)
      setOpen(false)
    }
  }

  function triggerLabel(): string {
    if (props.multiple) {
      if (props.value.length === 0) return props.placeholder ?? 'Select…'
      if (props.value.length === 1) return optionsById.get(props.value[0]!)?.label ?? '1 selected'
      return `${props.value.length} selected`
    }
    if (!props.value) return props.placeholder ?? 'Select…'
    return optionsById.get(props.value)?.label ?? '…'
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={props.disabled}
          className={cn('w-full justify-between font-normal', props.className)}
        >
          <span className="truncate">{triggerLabel()}</span>
          <ChevronUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={!props.onSearchChange}>
          <CommandInput
            placeholder={props.searchPlaceholder ?? 'Search…'}
            value={search}
            onValueChange={(q) => {
              setSearch(q)
              props.onSearchChange?.(q)
            }}
          />
          <CommandList>
            <CommandEmpty>
              {props.isLoading ? 'Loading…' : (props.emptyMessage ?? 'No results.')}
            </CommandEmpty>
            <CommandGroup>
              {!props.multiple && props.allowClear && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    ;(props as SingleProps<TId>).onValueChange(null)
                    setOpen(false)
                  }}
                >
                  <CheckIcon
                    className={cn(
                      'mr-2 h-4 w-4',
                      props.value == null ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="text-muted-foreground">{props.clearLabel ?? 'Clear'}</span>
                </CommandItem>
              )}
              {props.options.map((opt) => {
                const isSelected = props.multiple
                  ? props.value.includes(opt.id)
                  : props.value === opt.id
                return (
                  <CommandItem
                    key={opt.id}
                    value={opt.id}
                    onSelect={() => toggle(opt.id)}
                    className="flex items-center gap-2"
                  >
                    <CheckIcon
                      className={cn('h-4 w-4', isSelected ? 'opacity-100' : 'opacity-0')}
                    />
                    {opt.leading}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{opt.label}</div>
                      {opt.description && (
                        <div className="truncate text-xs text-muted-foreground">
                          {opt.description}
                        </div>
                      )}
                    </div>
                    {opt.trailing}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
