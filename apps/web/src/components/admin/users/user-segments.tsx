'use client'

import { useState } from 'react'
import { XMarkIcon, BoltIcon, PlusIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import type { UserSegmentSummary } from '@/lib/server/domains/users/user.types'
import type { SegmentId, PrincipalId } from '@quackback/ids'
import { useRemoveUsersFromSegment, useAssignUsersToSegment } from '@/lib/client/mutations'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'

interface SegmentBadgeProps {
  segment: UserSegmentSummary
  onRemove?: (segmentId: SegmentId) => void
  isRemoving?: boolean
  readOnly?: boolean
}

export function SegmentBadge({ segment, onRemove, isRemoving, readOnly }: SegmentBadgeProps) {
  const canRemove = !readOnly && segment.type === 'manual' && !!onRemove

  return (
    <span
      className={cn(
        'group inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border',
        'transition-colors'
      )}
      style={{
        backgroundColor: segment.color + '20',
        borderColor: segment.color + '40',
        color: segment.color,
      }}
      title={segment.type === 'dynamic' ? 'Auto-managed segment' : segment.name}
    >
      {segment.type === 'dynamic' && <BoltIcon className="h-2.5 w-2.5 shrink-0 opacity-70" />}
      <span>{segment.name}</span>
      {canRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove(segment.id)
          }}
          disabled={isRemoving}
          className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-500 disabled:opacity-50"
          aria-label={`Remove from ${segment.name}`}
        >
          <XMarkIcon className="h-3 w-3" />
        </button>
      )}
    </span>
  )
}

interface UserSegmentBadgesProps {
  principalId: PrincipalId
  segments: UserSegmentSummary[]
  canManage?: boolean
  onSegmentsChange?: () => void
}

export function UserSegmentBadges({
  principalId,
  segments,
  canManage = false,
  onSegmentsChange,
}: UserSegmentBadgesProps) {
  const { data: allSegments } = useSegments()
  const removeUsers = useRemoveUsersFromSegment()
  const assignUsers = useAssignUsersToSegment()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [removingId, setRemovingId] = useState<SegmentId | null>(null)

  const handleRemove = async (segmentId: SegmentId) => {
    setRemovingId(segmentId)
    try {
      await removeUsers.mutateAsync({ segmentId, principalIds: [principalId] })
      onSegmentsChange?.()
    } finally {
      setRemovingId(null)
    }
  }

  const handleAssign = async (segmentId: SegmentId) => {
    await assignUsers.mutateAsync({ segmentId, principalIds: [principalId] })
    onSegmentsChange?.()
    setPopoverOpen(false)
  }

  // Manual segments the user is not currently in
  const currentSegmentIds = new Set(segments.map((s) => s.id))
  const availableManualSegments = (allSegments ?? []).filter(
    (s) => s.type === 'manual' && !currentSegmentIds.has(s.id as SegmentId)
  )

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {segments.map((seg) => (
        <SegmentBadge
          key={seg.id}
          segment={seg}
          onRemove={canManage ? handleRemove : undefined}
          isRemoving={removingId === seg.id}
          readOnly={!canManage}
        />
      ))}

      {canManage && availableManualSegments.length > 0 && (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <PlusIcon className="h-3 w-3 mr-0.5" />
              Add
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="start">
            <div className="space-y-0.5">
              {availableManualSegments.map((seg) => (
                <button
                  key={seg.id}
                  type="button"
                  onClick={() => handleAssign(seg.id as SegmentId)}
                  disabled={assignUsers.isPending}
                  className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted/50 transition-colors disabled:opacity-50"
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0 ring-1 ring-inset ring-black/10"
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className="truncate">{seg.name}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {segments.length === 0 && !canManage && (
        <span className="text-xs text-muted-foreground">No segments</span>
      )}
    </div>
  )
}

interface CompactSegmentBadgesProps {
  segments: UserSegmentSummary[]
  maxVisible?: number
}

export function CompactSegmentBadges({ segments, maxVisible = 2 }: CompactSegmentBadgesProps) {
  if (segments.length === 0) return null

  const visible = segments.slice(0, maxVisible)
  const overflow = segments.length - maxVisible

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {visible.map((seg) => (
        <span
          key={seg.id}
          className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[10px] font-medium border leading-4"
          style={{
            backgroundColor: seg.color + '20',
            borderColor: seg.color + '40',
            color: seg.color,
          }}
          title={seg.type === 'dynamic' ? `${seg.name} (auto)` : seg.name}
        >
          {seg.type === 'dynamic' && <BoltIcon className="h-2 w-2 shrink-0" />}
          {seg.name}
        </span>
      ))}
      {overflow > 0 && <span className="text-[10px] text-muted-foreground">+{overflow}</span>}
    </div>
  )
}
