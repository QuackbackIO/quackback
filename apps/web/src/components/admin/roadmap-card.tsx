import { memo } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { ChevronUpIcon } from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'
import type { RoadmapPostEntry } from '@/lib/roadmaps'

interface RoadmapCardProps {
  post: RoadmapPostEntry
  statusId: string
}

export const RoadmapCard = memo(function RoadmapCard({ post, statusId }: RoadmapCardProps) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: post.id,
    data: { type: 'Task', post, statusId },
  })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.4 : 1 }}
      className="flex bg-card rounded-lg border shadow-sm cursor-grab active:cursor-grabbing transition-opacity duration-150"
    >
      <CardContent post={post} />
    </div>
  )
})

function CardContent({ post }: { post: RoadmapPostEntry }) {
  return (
    <>
      <div className="flex flex-col items-center justify-center w-14 shrink-0 border-r border-border/50 text-muted-foreground">
        <ChevronUpIcon className="h-4 w-4" />
        <span className="text-sm font-bold text-foreground">{post.voteCount}</span>
      </div>
      <div className="flex-1 min-w-0 p-4">
        <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug">
          {post.title}
        </p>
        <Badge variant="secondary" className="mt-2.5 text-xs">
          {post.board.name}
        </Badge>
      </div>
    </>
  )
}

export function RoadmapCardOverlay({ post }: { post: RoadmapPostEntry }) {
  return (
    <div className="flex bg-card rounded-lg border shadow-lg cursor-grabbing w-[320px]">
      <CardContent post={post} />
    </div>
  )
}
