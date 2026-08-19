import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
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
import { toast } from 'sonner'
import { RoadmapSidebar } from './roadmap-sidebar'
import { RoadmapColumn } from './roadmap-column'
import { RoadmapCardOverlay } from './roadmap-card'
import { RoadmapFiltersBar } from './roadmap/roadmap-filters-bar'
import { EmptyState } from '@/components/shared/empty-state'
import { useRoadmaps } from '@/lib/client/hooks/use-roadmaps-query'
import { useRoadmapDateBuckets } from '@/lib/client/hooks/use-roadmaps-query'
import { useRoadmapSelection } from './use-roadmap-selection'
import { useRoadmapFilters } from './roadmap/use-roadmap-filters'
import { useChangePostStatusId, useSetPostEta } from '@/lib/client/mutations/posts'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import { adminQueries } from '@/lib/client/queries/admin'
import { roadmapPostsKeys } from '@/lib/client/hooks/use-roadmap-posts-query'
import { Route } from '@/routes/admin/roadmap'
import type { RoadmapViewPost, RoadmapPostsListResult } from '@/lib/shared/types'
import type { PostStatusId, PostId, RoadmapId } from '@quackback/ids'

export function RoadmapAdmin() {
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
  const setEta = useSetPostEta()
  const queryClient = useQueryClient()

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
  const { data: dateBuckets = [] } = useRoadmapDateBuckets(
    (selectedRoadmapId ?? 'roadmap_00000000000000000000000000') as RoadmapId,
    { enabled: selectedRoadmap?.type === 'date' }
  )

  // Track dragged post for overlay
  const [activePost, setActivePost] = useState<RoadmapViewPost | null>(null)

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

  function handleDragEnd(event: DragEndEvent) {
    setActivePost(null)

    const { active, over } = event
    if (!over || over.data.current?.type !== 'Column') return

    const draggedPost = active.data.current?.post as RoadmapViewPost | undefined
    const targetStatusId = over.data.current.statusId as PostStatusId | undefined
    const targetBucketId = over.data.current.bucketId as string | undefined

    // Optimistically move the dragged card between the two roadmap columns so it
    // stays where it was dropped instead of snapping back to its source column
    // while the mutation is in flight. The mutation's own narrow roadmap
    // invalidation reconciles against server truth on settle; on error we restore
    // the two column caches from the snapshot taken here (paired with the
    // mutation's own detail/inbox rollback).
    if (
      selectedRoadmap?.type === 'column' &&
      targetStatusId &&
      draggedPost &&
      draggedPost.statusId !== targetStatusId
    ) {
      const postId = active.id as PostId
      const roadmapId = selectedRoadmapId as RoadmapId
      const sourceKey = roadmapPostsKeys.byRoadmap(
        roadmapId,
        draggedPost.statusId ?? undefined,
        undefined,
        filters
      )
      const targetKey = roadmapPostsKeys.byRoadmap(roadmapId, targetStatusId, undefined, filters)
      const previousSource =
        queryClient.getQueryData<InfiniteData<RoadmapPostsListResult>>(sourceKey)
      const previousTarget =
        queryClient.getQueryData<InfiniteData<RoadmapPostsListResult>>(targetKey)

      // Remove from the source column.
      queryClient.setQueryData<InfiniteData<RoadmapPostsListResult>>(sourceKey, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.filter((p) => p.id !== postId),
                total: Math.max(0, page.total - (page.items.some((p) => p.id === postId) ? 1 : 0)),
              })),
            }
          : old
      )
      // Insert at the head of the target column (if that column is cached).
      queryClient.setQueryData<InfiniteData<RoadmapPostsListResult>>(targetKey, (old) => {
        if (!old || old.pages.length === 0) return old
        const movedPost: RoadmapViewPost = { ...draggedPost, statusId: targetStatusId }
        return {
          ...old,
          pages: old.pages.map((page, index) =>
            index === 0
              ? { ...page, items: [movedPost, ...page.items], total: page.total + 1 }
              : page
          ),
        }
      })

      changeStatus.mutate(
        { postId, statusId: targetStatusId },
        {
          onError: () => {
            // Restore the two column caches we hand-moved above.
            if (previousSource) queryClient.setQueryData(sourceKey, previousSource)
            if (previousTarget) queryClient.setQueryData(targetKey, previousTarget)
            toast.error('Could not move the post. Try again.')
          },
        }
      )
    } else if (selectedRoadmap?.type === 'date' && targetBucketId) {
      const bucket = dateBuckets.find((item) => item.id === targetBucketId)
      const currentEta = draggedPost?.eta ? new Date(draggedPost.eta).toISOString() : null
      if (bucket && (bucket.targetMonth ?? null) !== currentEta) {
        setEta.mutate(
          { postId: active.id as PostId, eta: bucket.targetMonth },
          { onError: () => toast.error('Could not update the ETA. Try again.') }
        )
      }
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
                  {selectedRoadmap.type === 'column' &&
                    selectedRoadmap.columns.map((column) => (
                      <RoadmapColumn
                        key={column.id}
                        roadmapId={selectedRoadmapId as RoadmapId}
                        columnId={column.id}
                        statusId={column.statusId}
                        title={column.name}
                        icon={column.icon}
                        color={column.color}
                        filters={filters}
                        onCardClick={handleCardClick}
                      />
                    ))}
                  {selectedRoadmap.type === 'date' &&
                    dateBuckets.map((bucket) => (
                      <RoadmapColumn
                        key={bucket.id}
                        roadmapId={selectedRoadmapId as RoadmapId}
                        columnId={bucket.id}
                        bucketId={bucket.id}
                        title={bucket.label}
                        subtitle={
                          bucket.targetMonth
                            ? `Sets ETA to ${new Intl.DateTimeFormat('en-US', {
                                month: 'short',
                                year: 'numeric',
                                timeZone: 'UTC',
                              }).format(new Date(bucket.targetMonth))}`
                            : 'Clears ETA'
                        }
                        color={bucket.noEta ? '#6b7280' : '#3b82f6'}
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
            <EmptyState
              icon={MapIcon}
              title="No roadmap selected"
              description="Create or select a roadmap from the sidebar"
            />
          </div>
        )}
      </main>
    </div>
  )
}
