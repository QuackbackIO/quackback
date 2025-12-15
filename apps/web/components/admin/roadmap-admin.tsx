'use client'

import { useState, useCallback } from 'react'
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
import { ChevronUp, Map } from 'lucide-react'
import { RoadmapSidebar } from './roadmap-sidebar'
import { AdminRoadmapColumn } from './roadmap-column'
import { Badge } from '@/components/ui/badge'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { useRoadmaps } from '@/lib/hooks/use-roadmaps-query'
import { useChangePostStatusId } from '@/lib/hooks/use-inbox-queries'
import type { PostStatusEntity } from '@quackback/db/types'
import type { RoadmapPostEntry } from '@quackback/domain'
import type { StatusId, PostId } from '@quackback/ids'

interface RoadmapAdminProps {
  organizationId: string
  statuses: PostStatusEntity[]
}

export function RoadmapAdmin({ organizationId, statuses }: RoadmapAdminProps) {
  const [selectedRoadmapId, setSelectedRoadmapId] = useState<string | null>(null)
  const { data: roadmaps } = useRoadmaps({ organizationId })

  // Auto-select first roadmap when loaded
  if (roadmaps && roadmaps.length > 0 && selectedRoadmapId === null) {
    setSelectedRoadmapId(roadmaps[0].id)
  }

  const selectedRoadmap = roadmaps?.find((r) => r.id === selectedRoadmapId)

  // Change post status mutation (updates the post's actual status)
  const changeStatus = useChangePostStatusId(organizationId)

  // DnD state
  const [activePost, setActivePost] = useState<RoadmapPostEntry | null>(null)
  const [activeStatusId, setActiveStatusId] = useState<StatusId | null>(null)
  const [overStatusId, setOverStatusId] = useState<StatusId | null>(null)

  // Set of all column IDs for collision detection
  const columnIds = new Set(statuses.map((s) => s.id))

  // Custom collision detection
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args)
    if (pointerCollisions.length > 0) {
      const collision = getFirstCollision(pointerCollisions, 'id')
      if (collision) {
        return pointerCollisions
      }
    }
    return rectIntersection(args)
  }, [])

  // Configure DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
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
      setActivePost(activeData.post)
    }
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event

    if (!over) {
      setOverStatusId(null)
      return
    }

    const overData = over.data.current
    let targetStatusId: StatusId | null = null

    if (overData?.type === 'column') {
      targetStatusId = overData.statusId
    } else if (overData?.type === 'post') {
      targetStatusId = overData.statusId
    } else if (columnIds.has(over.id as StatusId)) {
      targetStatusId = over.id as StatusId
    }

    setOverStatusId(targetStatusId)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event

    // Reset state
    setActivePost(null)
    setActiveStatusId(null)
    setOverStatusId(null)

    if (!over || !selectedRoadmapId) return

    const activeData = active.data.current
    const overData = over.data.current

    const sourceStatusId = activeData?.statusId as StatusId | undefined
    let targetStatusId: StatusId | undefined

    if (overData?.type === 'column') {
      targetStatusId = overData.statusId
    } else if (overData?.type === 'post') {
      targetStatusId = overData.statusId
    } else if (columnIds.has(over.id as StatusId)) {
      targetStatusId = over.id as StatusId
    }

    if (!sourceStatusId || !targetStatusId || sourceStatusId === targetStatusId) {
      return
    }

    const postId = active.id as PostId

    try {
      // Update the post's actual status (not a roadmap-specific status)
      await changeStatus.mutateAsync({ postId, statusId: targetStatusId })
    } catch (error) {
      console.error('Failed to change post status:', error)
    }
  }

  const handleDragCancel = () => {
    setActivePost(null)
    setActiveStatusId(null)
    setOverStatusId(null)
  }

  return (
    <div className="flex h-[calc(100vh-69px)] bg-background">
      {/* Sidebar */}
      <RoadmapSidebar
        organizationId={organizationId}
        selectedRoadmapId={selectedRoadmapId}
        onSelectRoadmap={setSelectedRoadmapId}
      />

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden">
        {selectedRoadmap ? (
          <>
            {/* Header */}
            <div className="px-6 py-4 border-b border-border/50 bg-card/50">
              <h2 className="text-lg font-semibold text-foreground">{selectedRoadmap.name}</h2>
              {selectedRoadmap.description && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {selectedRoadmap.description}
                </p>
              )}
            </div>

            {/* Board */}
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <ScrollArea className="flex-1">
                <div className="flex gap-4 p-6 h-full min-h-[calc(100vh-69px-73px)]">
                  {statuses.map((status) => (
                    <AdminRoadmapColumn
                      key={status.id}
                      organizationId={organizationId}
                      roadmapId={selectedRoadmapId!}
                      statusId={status.id}
                      title={status.name}
                      color={status.color}
                      isOver={overStatusId === status.id && activeStatusId !== status.id}
                    />
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>

              <DragOverlay>
                {activePost ? (
                  <div className="flex bg-card rounded-lg border border-border shadow-lg w-[280px] cursor-grabbing rotate-2">
                    <div className="flex flex-col items-center justify-center w-12 shrink-0 border-r border-border/30 text-muted-foreground">
                      <ChevronUp className="h-4 w-4" />
                      <span className="text-sm font-bold text-foreground">
                        {activePost.voteCount}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0 p-3">
                      <p className="text-sm font-medium text-foreground line-clamp-2">
                        {activePost.title}
                      </p>
                      <Badge variant="secondary" className="mt-2 text-[11px]">
                        {activePost.board.name}
                      </Badge>
                    </div>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 mx-auto mb-4">
                <Map className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">No roadmap selected</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Create a roadmap using the sidebar or select an existing one
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
