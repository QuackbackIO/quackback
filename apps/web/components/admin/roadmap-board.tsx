'use client'

import { useCallback, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  getFirstCollision,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronUp } from 'lucide-react'
import { AdminRoadmapColumn } from './roadmap-column'
import { Badge } from '@/components/ui/badge'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { roadmapPostsKeys } from '@/lib/hooks/use-roadmap-posts-query'
import type { PostStatusEntity } from '@quackback/db/types'
import type { RoadmapPostListResult, RoadmapPost } from '@quackback/domain'

interface StatusInitialData {
  statusSlug: string
  data: RoadmapPostListResult
}

interface AdminRoadmapBoardProps {
  organizationId: string
  statuses: PostStatusEntity[]
  initialDataByStatus: StatusInitialData[]
}

export function AdminRoadmapBoard({
  organizationId,
  statuses,
  initialDataByStatus,
}: AdminRoadmapBoardProps) {
  const queryClient = useQueryClient()
  const [activePost, setActivePost] = useState<RoadmapPost | null>(null)
  const [activeStatusId, setActiveStatusId] = useState<string | null>(null)
  const [overStatusId, setOverStatusId] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)

  // Create lookup map for initial data
  const dataByStatus = Object.fromEntries(initialDataByStatus.map((d) => [d.statusSlug, d.data]))

  // Create lookup map for status by ID
  const statusById = Object.fromEntries(statuses.map((s) => [s.id, s]))

  // Set of all column IDs for collision detection
  const columnIds = new Set(statuses.map((s) => s.id))

  // Custom collision detection: prioritize pointer position, then rectangle intersection
  const collisionDetection: CollisionDetection = useCallback((args) => {
    // First check if pointer is within any droppable
    const pointerCollisions = pointerWithin(args)

    if (pointerCollisions.length > 0) {
      // If we hit something, return it
      const collision = getFirstCollision(pointerCollisions, 'id')
      if (collision) {
        return pointerCollisions
      }
    }

    // Fall back to rectangle intersection for edge cases
    return rectIntersection(args)
  }, [])

  // Configure DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const activeData = active.data.current

    if (activeData?.type === 'post') {
      setActiveStatusId(activeData.statusId)
      // Find the post in our data
      for (const statusData of initialDataByStatus) {
        const post = statusData.data.items.find((p) => p.id === active.id)
        if (post) {
          setActivePost(post)
          break
        }
      }
    }
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event

    if (!over) {
      setOverStatusId(null)
      return
    }

    const overData = over.data.current

    // Determine which column we're over
    let targetStatusId: string | null = null

    if (overData?.type === 'column') {
      targetStatusId = overData.statusId
    } else if (overData?.type === 'post') {
      // When over a card, use its statusId
      targetStatusId = overData.statusId
    } else if (columnIds.has(over.id as string)) {
      // Direct column ID match
      targetStatusId = over.id as string
    }

    setOverStatusId(targetStatusId)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event

    // Reset state
    setActivePost(null)
    setActiveStatusId(null)
    setOverStatusId(null)

    if (!over || isUpdating) return

    const activeData = active.data.current
    const overData = over.data.current

    // Get the source status from the dragged item
    const sourceStatusId = activeData?.statusId

    // Get the target status - could be a column or another post
    let targetStatusId: string | undefined

    if (overData?.type === 'column') {
      targetStatusId = overData.statusId
    } else if (overData?.type === 'post') {
      targetStatusId = overData.statusId
    } else if (columnIds.has(over.id as string)) {
      // Direct column ID match
      targetStatusId = over.id as string
    }

    // If dropped on same status or no target, do nothing
    if (!sourceStatusId || !targetStatusId || sourceStatusId === targetStatusId) {
      return
    }

    const postId = active.id as string
    const sourceStatus = statusById[sourceStatusId]
    const targetStatus = statusById[targetStatusId]

    if (!sourceStatus || !targetStatus) return

    setIsUpdating(true)

    try {
      // Call the API to change status
      const response = await fetch(`/api/posts/${postId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          statusId: targetStatusId,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        console.error('Failed to change status:', error)
        return
      }

      // Invalidate queries for both affected columns
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: roadmapPostsKeys.list(organizationId, sourceStatus.slug),
        }),
        queryClient.invalidateQueries({
          queryKey: roadmapPostsKeys.list(organizationId, targetStatus.slug),
        }),
      ])
    } catch (error) {
      console.error('Failed to change status:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleDragCancel = () => {
    setActivePost(null)
    setActiveStatusId(null)
    setOverStatusId(null)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <ScrollArea className="w-full" style={{ height: 'calc(100vh - 12rem)' }}>
        <div className="flex gap-4 pb-4 h-full">
          {statuses.map((status) => (
            <AdminRoadmapColumn
              key={status.id}
              organizationId={organizationId}
              statusId={status.id}
              statusSlug={status.slug}
              title={status.name}
              color={status.color}
              initialData={dataByStatus[status.slug]}
              isOver={overStatusId === status.id && activeStatusId !== status.id}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Drag overlay for visual feedback */}
      <DragOverlay>
        {activePost ? (
          <div className="flex bg-card rounded-lg border border-border shadow-lg w-[280px] cursor-grabbing rotate-2">
            <div className="flex flex-col items-center justify-center w-12 shrink-0 border-r border-border/30 text-muted-foreground">
              <ChevronUp className="h-4 w-4" />
              <span className="text-sm font-bold text-foreground">{activePost.voteCount}</span>
            </div>
            <div className="flex-1 min-w-0 p-3">
              <p className="text-sm font-medium text-foreground line-clamp-2">{activePost.title}</p>
              <Badge variant="secondary" className="mt-2 text-[11px]">
                {activePost.board.name}
              </Badge>
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
