import { memo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { ArrowPathIcon, InboxIcon } from '@heroicons/react/24/solid'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { EmptyState } from '@/components/shared/empty-state'
import { RoadmapCard } from './roadmap-card'
import { cn } from '@/lib/shared/utils'
import {
  useRoadmapPostsByRoadmap,
  flattenRoadmapPostEntries,
} from '@/lib/client/hooks/use-roadmap-posts-query'
import type { RoadmapId, StatusId } from '@quackback/ids'

interface RoadmapColumnProps {
  roadmapId: RoadmapId
  statusId: StatusId
  title: string
  color: string
  onCardClick?: (postId: string) => void
}

export const RoadmapColumn = memo(function RoadmapColumn({
  roadmapId,
  statusId,
  title,
  color,
  onCardClick,
}: RoadmapColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: statusId,
    data: { type: 'Column', statusId },
  })

  const { data, isFetchingNextPage, hasNextPage, fetchNextPage, isLoading } =
    useRoadmapPostsByRoadmap({ roadmapId, statusId })

  const posts = flattenRoadmapPostEntries(data)
  const total = data?.pages[0]?.total ?? 0

  const sentinelRef = useInfiniteScroll({
    hasMore: hasNextPage,
    isFetching: isFetchingNextPage,
    onLoadMore: fetchNextPage,
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'min-w-[280px] max-w-[360px] flex-1 flex flex-col rounded-xl p-3 bg-muted/30 transition-colors duration-200',
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
          <EmptyState icon={InboxIcon} title="No items" className="py-8" />
        ) : (
          <>
            {posts.map((post) => (
              <RoadmapCard
                key={post.id}
                post={post}
                statusId={statusId}
                onClick={onCardClick ? () => onCardClick(post.id) : undefined}
              />
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
