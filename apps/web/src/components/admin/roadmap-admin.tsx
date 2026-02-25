import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { MapIcon } from '@heroicons/react/24/solid'
import { RoadmapSidebar } from './roadmap-sidebar'
import { RoadmapColumn } from './roadmap-column'
import { RoadmapCardOverlay } from './roadmap-card'
import { RoadmapFiltersBar } from './roadmap/roadmap-filters-bar'
import { useRoadmaps } from '@/lib/client/hooks/use-roadmaps-query'
import { useRoadmapSelection } from './use-roadmap-selection'
import { useRoadmapFilters } from './roadmap/use-roadmap-filters'
import { useChangePostStatusId } from '@/lib/client/mutations/posts'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import { adminQueries } from '@/lib/client/queries/admin'
import { Route } from '@/routes/admin/roadmap'
import type { PostStatusEntity } from '@/lib/shared/db-types'
import type { RoadmapPostEntry } from '@/lib/server/domains/roadmaps'
import type { StatusId, PostId, RoadmapId } from '@quackback/ids'

interface RoadmapAdminProps {
  statuses: PostStatusEntity[]
}

export function RoadmapAdmin({ statuses }: RoadmapAdminProps) {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()

  // Filter state (URL-driven)
  const { filters, setFilters, clearFilters, toggleBoard, toggleTag, toggleSegment } =
    useRoadmapFilters()

  // Reference data for filter UI (pre-fetched in route loader)
  const { data: boards } = useSuspenseQuery(adminQueries.boards())
  const { data: tags } = useSuspenseQuery(adminQueries.tags())
  const { data: segments } = useSegments()
  const { selectedRoadmapId, setSelectedRoadmap } = useRoadmapSelection()
  const { data: roadmaps } = useRoadmaps()
  const changeStatus = useChangePostStatusId()

  const handleCardClick = (postId: string) => {
    navigate({ search: { ...search, post: postId } })
  }

  // Auto-select first roadmap
  useEffect(() => {
    if (roadmaps?.length && !selectedRoadmapId) {
      setSelectedRoadmap(roadmaps[0].id)
    }
  }, [roadmaps, selectedRoadmapId, setSelectedRoadmap])

  const selectedRoadmap = roadmaps?.find((r) => r.id === selectedRoadmapId)

  // Track dragged post for overlay
  const [activePost, setActivePost] = useState<RoadmapPostEntry | null>(null)

  // Distance threshold: drag only starts after moving 8px (like Trello)
  // This allows click to work normally if pointer doesn't move much
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  function handleDragStart(event: DragStartEvent) {
    const { active } = event
    if (active.data.current?.type === 'Task') {
      setActivePost(active.data.current.post)
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActivePost(null)

    const { active, over } = event
    if (!over || over.data.current?.type !== 'Column') return

    const sourceStatusId = active.data.current?.statusId as StatusId
    const targetStatusId = over.data.current.statusId as StatusId

    if (sourceStatusId !== targetStatusId) {
      await changeStatus.mutateAsync({
        postId: active.id as PostId,
        statusId: targetStatusId,
      })
    }
  }

  return (
    <div className="flex h-full bg-background">
      <RoadmapSidebar selectedRoadmapId={selectedRoadmapId} onSelectRoadmap={setSelectedRoadmap} />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {selectedRoadmap ? (
          <>
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border/50 bg-card/50 space-y-3">
              <div>
                <h2 className="text-lg font-semibold">{selectedRoadmap.name}</h2>
                {selectedRoadmap.description && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {selectedRoadmap.description}
                  </p>
                )}
              </div>
              <RoadmapFiltersBar
                filters={filters}
                onFiltersChange={setFilters}
                onClearAll={clearFilters}
                boards={boards}
                tags={tags}
                segments={segments}
                onToggleBoard={toggleBoard}
                onToggleTag={toggleTag}
                onToggleSegment={toggleSegment}
              />
            </div>

            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              autoScroll={false}
            >
              <div className="flex-1 overflow-auto p-4 sm:p-6">
                <div className="flex items-stretch gap-4 sm:gap-5">
                  {statuses.map((status) => (
                    <RoadmapColumn
                      key={status.id}
                      roadmapId={selectedRoadmapId as RoadmapId}
                      statusId={status.id}
                      title={status.name}
                      color={status.color}
                      filters={filters}
                      onCardClick={handleCardClick}
                    />
                  ))}
                </div>
              </div>

              {createPortal(
                <DragOverlay dropAnimation={null}>
                  {activePost && <RoadmapCardOverlay post={activePost} />}
                </DragOverlay>,
                document.body
              )}
            </DndContext>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 mx-auto mb-4">
                <MapIcon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold">No roadmap selected</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Create or select a roadmap from the sidebar
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
