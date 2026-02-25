'use client'

import { useState } from 'react'
import {
  PlusIcon,
  UsersIcon,
  PencilIcon,
  TrashIcon,
  BoltIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/shared/utils'
import type { SegmentListItem } from '@/lib/client/hooks/use-segments-queries'

interface UsersSegmentNavProps {
  segments: SegmentListItem[] | undefined
  isLoading: boolean
  selectedSegmentIds: string[]
  onSelectSegment: (segmentId: string, shiftKey: boolean) => void
  onClearSegments: () => void
  totalUserCount: number
  onCreateSegment: () => void
  onEditSegment: (segment: SegmentListItem) => void
  onDeleteSegment: (segment: SegmentListItem) => void
  onEvaluateSegment?: (segmentId: string) => void
  isEvaluating?: string | null
}

export function UsersSegmentNav({
  segments,
  isLoading,
  selectedSegmentIds,
  onSelectSegment,
  onClearSegments,
  totalUserCount,
  onCreateSegment,
  onEditSegment,
  onDeleteSegment,
  onEvaluateSegment,
  isEvaluating,
}: UsersSegmentNavProps) {
  const hasSelection = selectedSegmentIds.length > 0

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">Users</h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          onClick={onCreateSegment}
          title="Create segment"
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* All users */}
      <button
        type="button"
        onClick={() => {
          if (hasSelection) {
            onClearSegments()
          }
        }}
        className={cn(
          'w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-2',
          !hasSelection
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        )}
      >
        <UsersIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate">All users</span>
        <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums">
          {totalUserCount}
        </span>
      </button>

      {/* Divider */}
      <div className="border-b border-border/30 my-2" />

      {/* Segments */}
      {isLoading ? (
        <div className="space-y-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-7 bg-muted/30 rounded-md animate-pulse" />
          ))}
        </div>
      ) : !segments || segments.length === 0 ? (
        <p className="text-xs text-muted-foreground px-2.5 py-1.5">
          No segments yet. Click + to create one.
        </p>
      ) : (
        <div className="space-y-0.5">
          {segments.map((seg) => (
            <SegmentNavItem
              key={seg.id}
              segment={seg}
              isSelected={selectedSegmentIds.includes(seg.id)}
              onSelect={(shiftKey) => onSelectSegment(seg.id, shiftKey)}
              onEdit={() => onEditSegment(seg)}
              onDelete={() => onDeleteSegment(seg)}
              onEvaluate={
                seg.type === 'dynamic' && onEvaluateSegment
                  ? () => onEvaluateSegment(seg.id)
                  : undefined
              }
              isEvaluating={isEvaluating === seg.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SegmentNavItem({
  segment,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
  onEvaluate,
  isEvaluating,
}: {
  segment: SegmentListItem
  isSelected: boolean
  onSelect: (shiftKey: boolean) => void
  onEdit: () => void
  onDelete: () => void
  onEvaluate?: () => void
  isEvaluating: boolean
}) {
  return (
    <div
      className={cn(
        'group flex items-center rounded-md transition-colors',
        isSelected ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'
      )}
    >
      <button
        type="button"
        onClick={(e) => onSelect(e.shiftKey)}
        className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-left"
      >
        <span className="flex-1 truncate">{segment.name}</span>
        {segment.type === 'dynamic' && (
          <BoltIcon className="h-2.5 w-2.5 shrink-0 opacity-50" title="Dynamic segment" />
        )}
        <span className="group-hover:hidden text-[10px] text-muted-foreground/60 shrink-0 tabular-nums">
          {segment.memberCount}
        </span>
      </button>

      {/* Hover actions */}
      <div className="hidden group-hover:flex items-center shrink-0 pr-1">
        {onEvaluate && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onEvaluate()
            }}
            disabled={isEvaluating}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Re-evaluate"
          >
            <ArrowPathIcon className={cn('h-3 w-3', isEvaluating && 'animate-spin')} />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          title="Edit segment"
        >
          <PencilIcon className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
          title="Delete segment"
        >
          <TrashIcon className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

/**
 * Mobile segment selector - rendered as a compact multi-select dropdown
 */
export function MobileSegmentSelector({
  segments,
  selectedSegmentIds,
  onSelectSegment,
  onClearSegments,
}: {
  segments: SegmentListItem[] | undefined
  selectedSegmentIds: string[]
  onSelectSegment: (segmentId: string, shiftKey: boolean) => void
  onClearSegments: () => void
}) {
  const [open, setOpen] = useState(false)

  if (!segments || segments.length === 0) return null

  const selectedNames = segments.filter((s) => selectedSegmentIds.includes(s.id)).map((s) => s.name)

  const label =
    selectedNames.length === 0
      ? 'All users'
      : selectedNames.length === 1
        ? selectedNames[0]
        : `${selectedNames.length} segments`

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium',
          'border border-border/50 bg-card',
          'hover:bg-muted/50 transition-colors'
        )}
      >
        <UsersIcon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="truncate max-w-[160px]">{label}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-50 w-56 rounded-lg border border-border bg-popover shadow-md py-1">
            <button
              type="button"
              onClick={() => {
                onClearSegments()
                setOpen(false)
              }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-xs font-medium',
                'hover:bg-muted/50 transition-colors',
                selectedSegmentIds.length === 0 && 'bg-muted text-foreground'
              )}
            >
              All users
            </button>
            <div className="border-b border-border/30 my-1" />
            {segments.map((seg) => (
              <button
                key={seg.id}
                type="button"
                onClick={() => onSelectSegment(seg.id, true)}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-xs flex items-center gap-2',
                  'hover:bg-muted/50 transition-colors',
                  selectedSegmentIds.includes(seg.id) && 'bg-muted text-foreground font-medium'
                )}
              >
                <span className="flex-1 truncate">{seg.name}</span>
                {seg.type === 'dynamic' && <BoltIcon className="h-2.5 w-2.5 opacity-50" />}
                <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                  {seg.memberCount}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
