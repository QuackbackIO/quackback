import { CheckCircle2, MessageSquare, FileText, ThumbsUp } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { TimeAgo } from '@/components/ui/time-ago'
import { cn } from '@/lib/utils'
import type { PortalUserListItemView } from '@/lib/users'

interface UserCardProps {
  user: PortalUserListItemView
  isSelected: boolean
  onClick: () => void
}

export function UserCard({ user, isSelected, onClick }: UserCardProps) {
  const totalActivity = user.postCount + user.commentCount + user.voteCount

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 cursor-pointer transition-colors relative',
        isSelected
          ? 'bg-muted/50 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-primary'
          : 'hover:bg-muted/30'
      )}
      onClick={onClick}
    >
      {/* Avatar */}
      <Avatar src={user.image} name={user.name} className="h-10 w-10 shrink-0" />

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Name row */}
        <div className="flex items-center gap-1.5">
          <h3 className="font-medium text-sm text-foreground truncate">
            {user.name || 'Unnamed User'}
          </h3>
          {user.emailVerified && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
        </div>

        {/* Email */}
        <p className="text-sm text-muted-foreground truncate">{user.email}</p>

        {/* Join date */}
        <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
          <span>Joined</span>
          <TimeAgo date={new Date(user.joinedAt)} />
        </div>

        {/* Activity summary */}
        {totalActivity > 0 && (
          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
            {user.postCount > 0 && (
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {user.postCount}
              </span>
            )}
            {user.commentCount > 0 && (
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {user.commentCount}
              </span>
            )}
            {user.voteCount > 0 && (
              <span className="flex items-center gap-1">
                <ThumbsUp className="h-3 w-3" />
                {user.voteCount}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
