'use client'

import { TagIcon, XMarkIcon, ChevronDownIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { SegmentId } from '@quackback/ids'

interface ManualSegmentOption {
  id: SegmentId
  name: string
  color: string
}

interface UsersBulkSegmentBarProps {
  selectedCount: number
  manualSegments: ManualSegmentOption[]
  onAdd: (segmentId: SegmentId) => void
  onRemove: (segmentId: SegmentId) => void
  onClear: () => void
  isPending?: boolean
}

function SegmentDropdown({
  label,
  segments,
  onSelect,
  disabled,
}: {
  label: string
  segments: ManualSegmentOption[]
  onSelect: (segmentId: SegmentId) => void
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          disabled={disabled || segments.length === 0}
          title={segments.length === 0 ? 'No manual segments yet' : undefined}
        >
          {label}
          <ChevronDownIcon className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {segments.map((seg) => (
          <DropdownMenuItem key={seg.id} onClick={() => onSelect(seg.id)} className="text-xs gap-2">
            <span
              className="h-2 w-2 rounded-full shrink-0 ring-1 ring-inset ring-black/10"
              style={{ backgroundColor: seg.color }}
            />
            {seg.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function UsersBulkSegmentBar({
  selectedCount,
  manualSegments,
  onAdd,
  onRemove,
  onClear,
  isPending,
}: UsersBulkSegmentBarProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
      <TagIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-xs font-medium text-foreground">{selectedCount} selected</span>
      <div className="flex items-center gap-1.5 ml-auto">
        <SegmentDropdown
          label="Add to segment"
          segments={manualSegments}
          onSelect={onAdd}
          disabled={isPending}
        />
        <SegmentDropdown
          label="Remove from segment"
          segments={manualSegments}
          onSelect={onRemove}
          disabled={isPending}
        />
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClear}>
          <XMarkIcon className="h-3 w-3 mr-1" />
          Clear
        </Button>
      </div>
    </div>
  )
}
