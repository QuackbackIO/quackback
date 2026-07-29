import { Link } from '@tanstack/react-router'
import { ChevronUpIcon, Squares2X2Icon, CalendarIcon } from '@heroicons/react/24/solid'
import { ChatBubbleLeftIcon } from '@heroicons/react/24/outline'
import { Badge } from '@/components/ui/badge'
import { formatMonthYear } from '@/lib/shared/utils'

interface RoadmapCardProps {
  id: string
  title: string
  voteCount: number
  commentCount: number
  board: {
    slug: string
    name: string
  }
  /** Target ship date; rendered as a "Mar 2027" chip when present. */
  eta?: Date | string | null
}

export function RoadmapCard({
  id,
  title,
  voteCount,
  commentCount,
  board,
  eta,
}: RoadmapCardProps): React.ReactElement {
  const etaLabel = formatMonthYear(eta)
  return (
    <Link
      to="/b/$slug/posts/$postId"
      params={{ slug: board.slug, postId: id }}
      className="roadmap-card flex bg-[var(--post-card-background)] [border-radius:var(--radius)] border border-[var(--post-card-border)]/50 shadow-sm hover:bg-[var(--post-card-background)]/80 transition-colors"
    >
      <div className="roadmap-card__vote flex flex-col items-center justify-center w-12 shrink-0 border-e border-[var(--post-card-border)]/30 text-muted-foreground">
        <ChevronUpIcon className="h-5 w-5" />
        <span className="text-sm font-semibold text-foreground">{voteCount}</span>
      </div>
      <div className="roadmap-card__content flex-1 min-w-0 p-3">
        <p className="text-sm font-medium text-foreground line-clamp-2">{title}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="secondary" className="text-[11px] inline-flex items-center gap-0.5">
            <Squares2X2Icon className="h-3 w-3 text-muted-foreground/40" />
            {board.name}
          </Badge>
          {etaLabel && (
            <Badge variant="secondary" className="text-[11px] inline-flex items-center gap-0.5">
              <CalendarIcon className="h-3 w-3 text-muted-foreground/40" />
              {etaLabel}
            </Badge>
          )}
          {commentCount > 0 && (
            <span
              data-testid="roadmap-card-comment-count"
              className="ms-auto flex items-center gap-0.5"
            >
              <ChatBubbleLeftIcon className="h-3 w-3" />
              {commentCount}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
