/**
 * Generic destination picker (IF WO-7). A searchable combobox over an
 * integration's `destinations[kind]` — the target a created issue/task/card
 * lands in (Trello board, Jira project, GitHub repo, Linear team, ...).
 * Replaces the per-provider board/list/project pickers. For a dependent kind,
 * pass `parentId`; the picker stays disabled until a parent is chosen.
 */
import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowPathIcon, ChevronUpDownIcon, MagnifyingGlassIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  fetchIntegrationDestinationsFn,
  type DestinationItem,
} from '@/lib/server/functions/integration-destinations'

interface DestinationPickerProps {
  /** Integration type id (underscore form, e.g. `azure_devops`). */
  integrationType: string
  /** Destination kind (e.g. `board`, `project`, `repo`). */
  kind: string
  /** Currently selected destination id (the value stored in config). */
  value: string
  /** Called with the chosen id + display name. */
  onSelect: (id: string, name: string) => void
  /** For a dependent kind, the parent's selected id (undefined disables). */
  parentId?: string
  disabled?: boolean
  placeholder?: string
}

export function DestinationPicker({
  integrationType,
  kind,
  value,
  onSelect,
  parentId,
  disabled,
  placeholder = 'Select…',
}: DestinationPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const query = useQuery({
    queryKey: ['integration-destinations', integrationType, kind, parentId ?? null],
    queryFn: () => fetchIntegrationDestinationsFn({ data: { integrationType, kind, parentId } }),
    staleTime: 5 * 60 * 1000,
    // A dependent kind can't load until its parent is chosen.
    enabled: parentId !== undefined ? parentId.length > 0 : true,
  })

  const items: DestinationItem[] = query.data ?? []
  const selected = items.find((i) => i.id === value)
  const loading = query.isLoading || query.isFetching
  const filtered = useMemo(
    () =>
      search ? items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase())) : items,
    [items, search]
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          {loading ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
              Loading…
            </span>
          ) : selected ? (
            <span className="truncate">{selected.name}</span>
          ) : value ? (
            <span className="truncate">{value}</span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronUpDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-[200px] overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              {loading ? 'Loading…' : search ? 'No matches.' : 'Nothing available.'}
            </div>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors ${
                  item.id === value ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
                }`}
                onClick={() => {
                  onSelect(item.id, item.name)
                  setOpen(false)
                  setSearch('')
                }}
              >
                <span className="truncate">{item.name}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
