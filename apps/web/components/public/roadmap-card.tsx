import Link from 'next/link'
import { ChevronUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface RoadmapCardProps {
  id: string
  title: string
  voteCount: number
  board: {
    slug: string
    name: string
  }
}

export function RoadmapCard({ id, title, voteCount, board }: RoadmapCardProps) {
  return (
    <Link
      href={`/b/${board.slug}/posts/${id}`}
      className="flex bg-card rounded-lg border border-border/50 shadow-sm hover:bg-muted/30 transition-colors"
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
    </Link>
  )
}
