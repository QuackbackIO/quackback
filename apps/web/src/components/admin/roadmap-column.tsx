import { useEffect, useRef, memo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { RoadmapCard } from './roadmap-card'
import { cn } from '@/lib/utils'
import {
  useRoadmapPostsByRoadmap,
  flattenRoadmapPostEntries,
} from '@/lib/hooks/use-roadmap-posts-query'
import type { RoadmapId, StatusId } from '@quackback/ids'

interface RoadmapColumnProps {
  roadmapId: RoadmapId
  statusId: StatusId
  title: string
  color: string
}

export const RoadmapColumn = memo(function RoadmapColumn({
  roadmapId,
  statusId,
  title,
  color,
}: RoadmapColumnProps) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  const { setNodeRef, isOver } = useDroppable({
    id: statusId,
    data: { type: 'Column', statusId },
  })

  const { data, isFetchingNextPage, hasNextPage, fetchNextPage, isLoading } =
    useRoadmapPostsByRoadmap({ roadmapId, statusId })

  const posts = flattenRoadmapPostEntries(data)
  const total = data?.pages[0]?.total ?? 0

  // Infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasNextPage) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { rootMargin: '100px' }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'min-w-[320px] max-w-[380px] flex flex-col rounded-xl p-3 bg-muted/30 transition-colors duration-200',
        isOver && 'bg-primary/10'
      )}
    >
      <div className="flex items-center justify-between py-2 px-1 mb-2">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-sm font-medium text-muted-foreground">{title}</span>
        </div>
        <span className="text-xs text-muted-foreground">{total}</span>
      </div>

      <div
        className={cn(
          'flex flex-col gap-3 transition-all duration-200',
          isOver && 'opacity-50 blur-[1px]'
        )}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <ArrowPathIcon className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : posts.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-muted-foreground">No items</p>
          </div>
        ) : (
          <>
            {posts.map((post) => (
              <RoadmapCard key={post.id} post={post} statusId={statusId} />
            ))}
            {hasNextPage && (
              <div ref={sentinelRef} className="py-2 flex justify-center">
                {isFetchingNextPage && (
                  <ArrowPathIcon className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
})
