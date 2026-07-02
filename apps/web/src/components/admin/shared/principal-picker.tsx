/**
 * `<PrincipalPicker />` — async combobox over `searchPrincipalsFn`.
 *
 * Fires a debounced query as the user types and renders a picker list with
 * avatar + name + email + role. Used by every assignee / member / recipient
 * affordance in the agent and admin UIs.
 */
import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronUpDownIcon, CheckIcon } from '@heroicons/react/24/solid'
import type { PrincipalId } from '@quackback/ids'
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
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/shared/utils'
import {
  searchPrincipalsFn,
  getPrincipalsByIdsFn,
  type PrincipalSearchRow,
} from '@/lib/server/functions/principals'

interface BaseProps {
  placeholder?: string
  /** Filter the search to specific principal roles (e.g. 'user' for portal users). */
  roleFilter?: string[]
  /** Hide these IDs from the result list. Useful for "add member" flows. */
  excludeIds?: PrincipalId[]
  disabled?: boolean
  className?: string
}

interface SinglePickerProps extends BaseProps {
  multiple?: false
  value: PrincipalId | null
  onValueChange: (value: PrincipalId | null) => void
  /** Show "Unassigned" sentinel option that emits `null`. */
  allowUnassigned?: boolean
}

interface MultiPickerProps extends BaseProps {
  multiple: true
  value: PrincipalId[]
  onValueChange: (value: PrincipalId[]) => void
}

type PrincipalPickerProps = SinglePickerProps | MultiPickerProps

const principalSearchKey = (q: string, roleFilter?: string[], excludeIds?: PrincipalId[]) =>
  ['principals', 'search', q, roleFilter ?? [], excludeIds ?? []] as const

export function PrincipalPicker(props: PrincipalPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200)
    return () => clearTimeout(t)
  }, [search])

  const { data: results = [], isLoading } = useQuery({
    queryKey: principalSearchKey(debouncedSearch, props.roleFilter, props.excludeIds),
    queryFn: () =>
      searchPrincipalsFn({
        data: {
          query: debouncedSearch || undefined,
          roleFilter: props.roleFilter,
          excludeIds: props.excludeIds,
          limit: 25,
        },
      }),
    enabled: open,
    staleTime: 30_000,
  })

  // Resolve labels for current value(s) so the trigger always renders.
  const valueIds = useMemo<PrincipalId[]>(
    () => (props.multiple ? props.value : props.value ? [props.value] : []),
    [props]
  )
  const { data: selected = [] } = useQuery({
    queryKey: ['principals', 'byIds', valueIds],
    queryFn: () => getPrincipalsByIdsFn({ data: { ids: valueIds } }),
    enabled: valueIds.length > 0,
    staleTime: 60_000,
  })

  const selectedById = useMemo(() => new Map(selected.map((s) => [s.id, s] as const)), [selected])

  function toggle(id: PrincipalId) {
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

  function renderTriggerLabel() {
    if (props.multiple) {
      if (props.value.length === 0) return props.placeholder ?? 'Select people…'
      if (props.value.length === 1) {
        const row = selectedById.get(props.value[0]!)
        return labelOf(row) ?? '1 selected'
      }
      return `${props.value.length} selected`
    }
    if (!props.value) return props.placeholder ?? 'Select person…'
    const row = selectedById.get(props.value)
    return labelOf(row) ?? '…'
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
          <span className="truncate">{renderTriggerLabel()}</span>
          <ChevronUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by name or email…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{isLoading ? 'Searching…' : 'No matches.'}</CommandEmpty>
            <CommandGroup>
              {!props.multiple && 'allowUnassigned' in props && props.allowUnassigned && (
                <CommandItem
                  value="__unassigned__"
                  onSelect={() => {
                    ;(props as SinglePickerProps).onValueChange(null)
                    setOpen(false)
                  }}
                >
                  <CheckIcon
                    className={cn(
                      'mr-2 h-4 w-4',
                      props.value == null ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="text-muted-foreground">Unassigned</span>
                </CommandItem>
              )}
              {results.map((row) => {
                const isSelected = props.multiple
                  ? props.value.includes(row.id)
                  : props.value === row.id
                return (
                  <CommandItem
                    key={row.id}
                    value={row.id}
                    onSelect={() => toggle(row.id)}
                    className="flex items-center gap-2"
                  >
                    <CheckIcon
                      className={cn('h-4 w-4', isSelected ? 'opacity-100' : 'opacity-0')}
                    />
                    <Avatar className="h-6 w-6" src={row.avatarUrl} name={row.displayName} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">
                        {row.displayName ?? row.email ?? row.id}
                      </div>
                      {row.email && (
                        <div className="truncate text-xs text-muted-foreground">{row.email}</div>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{row.role}</span>
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

function labelOf(row: PrincipalSearchRow | undefined): string | null {
  if (!row) return null
  return row.displayName ?? row.email ?? row.id
}
