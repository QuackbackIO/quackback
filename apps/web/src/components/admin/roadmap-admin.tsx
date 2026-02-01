import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
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
import { useRoadmaps } from '@/lib/hooks/use-roadmaps-query'
import { useRoadmapSelection } from './use-roadmap-selection'
import { useChangePostStatusId } from '@/lib/mutations/posts'
import type { PostStatusEntity } from '@/lib/db-types'
import type { RoadmapPostEntry } from '@/lib/roadmaps'
import type { StatusId, PostId, RoadmapId } from '@quackback/ids'

interface RoadmapAdminProps {
  statuses: PostStatusEntity[]
}

export function RoadmapAdmin({ statuses }: RoadmapAdminProps) {
  const { selectedRoadmapId, setSelectedRoadmap } = useRoadmapSelection()
  const { data: roadmaps } = useRoadmaps()
  const changeStatus = useChangePostStatusId()

  // Auto-select first roadmap
  useEffect(() => {
    if (roadmaps?.length && !selectedRoadmapId) {
      setSelectedRoadmap(roadmaps[0].id)
    }
  }, [roadmaps, selectedRoadmapId, setSelectedRoadmap])

  const selectedRoadmap = roadmaps?.find((r) => r.id === selectedRoadmapId)

  // Track dragged post for overlay
  const [activePost, setActivePost] = useState<RoadmapPostEntry | null>(null)

  const sensors = useSensors(useSensor(PointerSensor))

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
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border/50 bg-card/50">
              <h2 className="text-lg font-semibold">{selectedRoadmap.name}</h2>
              {selectedRoadmap.description && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {selectedRoadmap.description}
                </p>
              )}
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
