import { memo } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { ChevronUpIcon, Bars3Icon } from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'
import type { RoadmapPostEntry } from '@/lib/server/domains/roadmaps'

interface RoadmapCardProps {
  post: RoadmapPostEntry
  statusId: string
  onClick?: () => void
}

export const RoadmapCard = memo(function RoadmapCard({
  post,
  statusId,
  onClick,
}: RoadmapCardProps) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: post.id,
    data: { type: 'Task', post, statusId },
  })

  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      style={{ opacity: isDragging ? 0.4 : 1 }}
      className="flex bg-card rounded-lg border shadow-sm cursor-pointer hover:bg-card/80 transition"
    >
      {/* Drag handle - only this area initiates drag */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="flex items-center justify-center w-8 shrink-0 border-r border-border/50 cursor-grab active:cursor-grabbing touch-none hover:bg-muted/50"
      >
        <Bars3Icon className="h-4 w-4 text-muted-foreground" />
      </button>
      <CardContent post={post} />
    </div>
  )
})

function CardContent({ post }: { post: RoadmapPostEntry }) {
  return (
    <>
      <div className="flex flex-col items-center justify-center w-14 shrink-0 border-r border-border/50 text-muted-foreground">
        <ChevronUpIcon className="h-4 w-4" />
        <span className="text-sm font-semibold text-foreground">{post.voteCount}</span>
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
