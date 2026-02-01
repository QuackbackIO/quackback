import { MapPinIcon, CheckCircleIcon } from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { TimeAgo } from '@/components/ui/time-ago'
import type { PinnedCommentView } from '@/lib/client/queries/portal-detail'

interface PinnedCommentProps {
  comment: PinnedCommentView
  workspaceName: string
}

function getInitials(name: string | null): string {
  if (!name) return '?'
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function PinnedComment({ comment, workspaceName }: PinnedCommentProps) {
  return (
    <div className="[border-radius:var(--radius)] border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <Avatar className="h-10 w-10 ring-2 ring-background shadow-md">
          {comment.avatarUrl && (
            <AvatarImage src={comment.avatarUrl} alt={comment.authorName || 'Team member'} />
          )}
          <AvatarFallback className="text-sm bg-primary/20 text-primary font-semibold">
            {getInitials(comment.authorName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">
              {comment.authorName || workspaceName}
            </span>
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground">
              <CheckCircleIcon className="h-3 w-3" />
            </span>
            <Badge className="text-[10px] px-1.5 py-0 bg-primary/15 text-primary border-0">
              <MapPinIcon className="h-2.5 w-2.5 mr-0.5" />
              Official
            </Badge>
            <span className="text-muted-foreground">·</span>
            <TimeAgo date={comment.createdAt} className="text-xs text-muted-foreground" />
          </div>
          <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
            {comment.content}
          </p>
        </div>
      </div>
    </div>
  )
}
