import { useDraggable, useDroppable } from '@dnd-kit/core'
import { ChevronUpIcon } from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'
import type { RoadmapPostEntry } from '@/lib/roadmaps'

interface AdminRoadmapCardProps {
  post: RoadmapPostEntry
  statusId: string
}

export function AdminRoadmapCard({ post, statusId }: AdminRoadmapCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    transform,
    isDragging,
  } = useDraggable({
    id: post.id,
    data: {
      type: 'post',
      postId: post.id,
      statusId,
      post,
    },
  })

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `droppable-${post.id}`,
    data: {
      type: 'post',
      postId: post.id,
      statusId,
    },
  })

  // Combine refs
  const setNodeRef = (node: HTMLElement | null) => {
    setDraggableRef(node)
    setDroppableRef(node)
  }

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex bg-card rounded-lg border cursor-grab active:cursor-grabbing transition-all ${
        isDragging
          ? 'opacity-50 border-primary shadow-lg scale-[1.02]'
          : isOver
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-border/80 hover:shadow-sm'
      }`}
    >
      <div className="flex flex-col items-center justify-center w-12 shrink-0 border-r border-border/30 text-muted-foreground">
        <ChevronUpIcon className="h-5 w-5" />
        <span className="text-sm font-bold text-foreground">{post.voteCount}</span>
      </div>
      <div className="flex-1 min-w-0 p-3">
        <p className="text-sm font-medium text-foreground line-clamp-2">{post.title}</p>
        <Badge variant="secondary" className="mt-2 text-[11px]">
          {post.board.name}
        </Badge>
      </div>
    </div>
  )
}
