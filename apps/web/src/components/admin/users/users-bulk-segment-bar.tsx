'use client'

import { useState } from 'react'
import { TagIcon, XMarkIcon, ChevronDownIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SegmentPickerList } from '@/components/admin/segments/segment-picker-list'
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
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
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
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <SegmentPickerList
          segments={segments}
          onSelect={(segmentId) => {
            onSelect(segmentId)
            setOpen(false)
          }}
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
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
