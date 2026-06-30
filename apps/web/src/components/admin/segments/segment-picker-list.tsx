'use client'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import type { SegmentId } from '@quackback/ids'

export interface SegmentPickerOption {
  id: SegmentId
  name: string
  color: string
}

interface SegmentPickerListProps {
  segments: SegmentPickerOption[]
  onSelect: (segmentId: SegmentId) => void
  disabled?: boolean
  emptyMessage?: string
  /** Show the search input once segments.length exceeds this. Default 6. */
  searchThreshold?: number
}

/**
 * Shared "pick one segment" list — colored dot + name, with a search input
 * that appears once the list is long enough to need filtering. Used by
 * every popover that lets an admin choose a manual segment to act on (the
 * per-user Add popover, the bulk Add/Remove dropdowns).
 */
export function SegmentPickerList({
  segments,
  onSelect,
  disabled,
  emptyMessage = 'No segments',
  searchThreshold = 6,
}: SegmentPickerListProps) {
  const showSearch = segments.length > searchThreshold

  return (
    <Command>
      {showSearch && <CommandInput placeholder="Search segments..." />}
      <CommandList>
        <CommandEmpty className="px-3 py-2 text-xs">{emptyMessage}</CommandEmpty>
        <CommandGroup>
          {segments.map((seg) => (
            <CommandItem
              key={seg.id}
              value={seg.name}
              disabled={disabled}
              onSelect={() => onSelect(seg.id)}
              className="gap-2 text-xs"
            >
              <span
                className="h-2 w-2 rounded-full shrink-0 ring-1 ring-inset ring-black/10"
                style={{ backgroundColor: seg.color }}
              />
              <span className="truncate">{seg.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
