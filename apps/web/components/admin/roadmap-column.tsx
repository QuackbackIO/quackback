'use client'

import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useDroppable } from '@dnd-kit/core'
import { AdminRoadmapCard } from './roadmap-card'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { useRoadmapPosts, flattenRoadmapPosts } from '@/lib/hooks/use-roadmap-posts-query'
import type { RoadmapPostListResult } from '@quackback/domain'

interface AdminRoadmapColumnProps {
  organizationId: string
  statusId: string
  statusSlug: string
  title: string
  color: string
  initialData?: RoadmapPostListResult
  isOver?: boolean
}

export function AdminRoadmapColumn({
  organizationId,
  statusId,
  statusSlug,
  title,
  color,
  initialData,
  isOver: isOverFromParent,
}: AdminRoadmapColumnProps) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Make the column itself droppable
  const { setNodeRef, isOver: isOverColumn } = useDroppable({
    id: statusId,
    data: {
      type: 'column',
      statusId,
      statusSlug,
    },
  })

  const { data, isFetchingNextPage, hasNextPage, fetchNextPage } = useRoadmapPosts({
    organizationId,
    statusSlug,
    initialData,
  })

  const posts = flattenRoadmapPosts(data)
  const total = data?.pages[0]?.total ?? initialData?.total ?? 0

  // Use either the parent's isOver state or the local one
  const isOver = isOverFromParent ?? isOverColumn

  // Intersection observer for infinite scroll
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
    <Card
      ref={setNodeRef}
      className={`flex-1 min-w-[300px] max-w-[350px] flex flex-col h-full transition-colors ${
        isOver ? 'ring-2 ring-primary bg-primary/5' : ''
      }`}
    >
      <CardHeader className="pb-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
            <CardTitle className="text-base font-semibold">{title}</CardTitle>
          </div>
          <Badge variant="secondary" className="text-xs">
            {total}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full px-6 pb-6">
          {posts.length === 0 ? (
            <div className="h-full flex items-center justify-center py-8">
              <p className="text-sm text-muted-foreground">No items yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {posts.map((post) => (
                <AdminRoadmapCard
                  key={post.id}
                  id={post.id}
                  title={post.title}
                  voteCount={post.voteCount}
                  statusId={statusId}
                  board={post.board}
                />
              ))}

              {/* Sentinel element for intersection observer */}
              {hasNextPage && (
                <div ref={sentinelRef} className="py-2 flex justify-center">
                  {isFetchingNextPage && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              )}
            </div>
          )}
          <ScrollBar />
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
