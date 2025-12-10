'use client'

import { ChevronUp } from 'lucide-react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Badge } from '@/components/ui/badge'

interface AdminRoadmapCardProps {
  id: string
  title: string
  voteCount: number
  statusId: string
  board: {
    slug: string
    name: string
  }
}

export function AdminRoadmapCard({ id, title, voteCount, statusId, board }: AdminRoadmapCardProps) {
  // Make the card draggable
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    transform,
    isDragging,
  } = useDraggable({
    id,
    data: {
      type: 'post',
      postId: id,
      statusId,
    },
  })

  // Also make it a drop target so other cards can be dropped on it
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `droppable-${id}`,
    data: {
      type: 'post',
      postId: id,
      statusId,
    },
  })

  // Combine refs
  const setNodeRef = (node: HTMLElement | null) => {
    setDraggableRef(node)
    setDroppableRef(node)
  }

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex bg-card rounded-lg border shadow-sm hover:bg-muted/30 hover:border-border transition-colors cursor-grab active:cursor-grabbing touch-none ${
        isOver ? 'border-primary ring-1 ring-primary' : 'border-border/50'
      }`}
    >
      {/* Vote section */}
      <div className="flex flex-col items-center justify-center w-12 shrink-0 border-r border-border/30 text-muted-foreground">
        <ChevronUp className="h-4 w-4" />
        <span className="text-sm font-bold text-foreground">{voteCount}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 p-3">
        <p className="text-sm font-medium text-foreground line-clamp-2">{title}</p>
        <Badge variant="secondary" className="mt-2 text-[11px]">
          {board.name}
        </Badge>
      </div>
    </div>
  )
}
