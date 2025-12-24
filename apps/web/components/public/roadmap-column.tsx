'use client'

import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { RoadmapCard } from './roadmap-card'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import {
  usePublicRoadmapPosts,
  flattenRoadmapPostEntries,
} from '@/lib/hooks/use-roadmap-posts-query'
import type { RoadmapId, StatusId, WorkspaceId } from '@quackback/ids'

interface RoadmapColumnProps {
  workspaceId: WorkspaceId
  roadmapId: RoadmapId
  statusId: StatusId
  title: string
  color: string
}

export function RoadmapColumn({
  workspaceId: _workspaceId,
  roadmapId,
  statusId,
  title,
  color,
}: RoadmapColumnProps) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  const { data, isFetchingNextPage, hasNextPage, fetchNextPage, isLoading } = usePublicRoadmapPosts(
    {
      roadmapId,
      statusId,
    }
  )

  const posts = flattenRoadmapPostEntries(data)
  const total = data?.pages[0]?.total ?? 0

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
    <Card className="flex-1 min-w-[300px] max-w-[350px] flex flex-col h-full">
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
          {isLoading ? (
            <div className="h-full flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : posts.length === 0 ? (
            <div className="h-full flex items-center justify-center py-8">
              <p className="text-sm text-muted-foreground">No items yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {posts.map((post) => (
                <RoadmapCard
                  key={post.id}
                  id={post.id}
                  title={post.title}
                  voteCount={post.voteCount}
                  board={{ slug: post.board.slug, name: post.board.name }}
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
