import { Link } from '@tanstack/react-router'
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
      to="/b/$slug/posts/$postId"
      params={{ slug: board.slug, postId: id }}
      className="roadmap-card flex bg-[var(--post-card-background)] [border-radius:var(--radius)] border border-[var(--post-card-border)]/50 shadow-sm hover:bg-[var(--post-card-background)]/80 transition-colors"
    >
      {/* Vote section */}
      <div className="roadmap-card__vote flex flex-col items-center justify-center w-12 shrink-0 border-r border-[var(--post-card-border)]/30 text-muted-foreground">
        <ChevronUp className="h-4 w-4" />
        <span className="text-sm font-bold text-foreground">{voteCount}</span>
      </div>

      {/* Content */}
      <div className="roadmap-card__content flex-1 min-w-0 p-3">
        <p className="text-sm font-medium text-foreground line-clamp-2">{title}</p>
        <Badge variant="secondary" className="mt-2 text-[11px]">
          {board.name}
        </Badge>
      </div>
    </Link>
  )
}
