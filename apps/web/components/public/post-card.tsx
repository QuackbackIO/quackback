import Link from 'next/link'
import { ChevronUp, MessageSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { TimeAgo } from '@/components/ui/time-ago'
import type { PostStatus } from '@quackback/db'

const STATUS_COLORS: Record<PostStatus, string> = {
  open: 'bg-blue-500',
  under_review: 'bg-yellow-500',
  planned: 'bg-purple-500',
  in_progress: 'bg-orange-500',
  complete: 'bg-green-500',
  closed: 'bg-gray-500',
}

const STATUS_LABELS: Record<PostStatus, string> = {
  open: 'Open',
  under_review: 'Under Review',
  planned: 'Planned',
  in_progress: 'In Progress',
  complete: 'Complete',
  closed: 'Closed',
}

interface PostCardProps {
  id: string
  title: string
  content: string
  status: PostStatus
  voteCount: number
  commentCount: number
  authorName: string | null
  createdAt: Date
  boardSlug: string
  tags: { id: string; name: string; color: string }[]
  hasVoted?: boolean
}

export function PostCard({
  id,
  title,
  content,
  status,
  voteCount,
  commentCount,
  authorName,
  createdAt,
  boardSlug,
  tags,
  hasVoted = false,
}: PostCardProps) {
  return (
    <Link href={`/boards/${boardSlug}/posts/${id}`}>
      <Card className="h-full transition-colors hover:bg-muted/50">
        <CardContent className="p-4">
          <div className="flex gap-4">
            {/* Vote section */}
            <div
              className={`flex flex-col items-center justify-center p-2 rounded-lg border ${
                hasVoted ? 'bg-primary/10 border-primary text-primary' : 'bg-muted'
              }`}
            >
              <ChevronUp className="h-5 w-5" />
              <span className="text-sm font-semibold">{voteCount}</span>
            </div>

            {/* Content section */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="font-semibold text-base line-clamp-1">{title}</h3>
                <Badge
                  variant="outline"
                  className={`shrink-0 text-xs text-white ${STATUS_COLORS[status]}`}
                >
                  {STATUS_LABELS[status]}
                </Badge>
              </div>

              <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{content}</p>

              {/* Tags */}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {tags.map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="secondary"
                      className="text-xs"
                      style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                    >
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>{commentCount}</span>
                </div>
                <span>·</span>
                <span>{authorName || 'Anonymous'}</span>
                <span>·</span>
                <TimeAgo date={createdAt} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
