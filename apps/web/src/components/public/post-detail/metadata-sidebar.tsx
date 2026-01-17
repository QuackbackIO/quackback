import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  FolderIcon,
  CalendarIcon,
  UserIcon,
  MapIcon,
  TagIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline'
import { portalDetailQueries } from '@/lib/queries/portal-detail'
import { StatusBadge } from '@/components/ui/status-badge'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { TimeAgo } from '@/components/ui/time-ago'
import { Skeleton } from '@/components/ui/skeleton'
import { AuthVoteButton } from '@/components/public/auth-vote-button'
import { AuthSubscriptionBell } from '@/components/public/auth-subscription-bell'
import { getInitials } from '@/lib/utils'
import type { PostId } from '@quackback/ids'

export function MetadataSidebarSkeleton() {
  return (
    <div className="w-72 shrink-0 border-l border-border/30 bg-muted/5 p-4 space-y-4">
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  )
}

function NoneLabel() {
  return <span className="text-sm italic text-muted-foreground">None</span>
}

interface MetadataSidebarProps {
  postId: PostId
  voteCount: number
  status?: { name: string; color: string | null } | null
  board: { name: string; slug: string }
  authorName: string | null
  authorAvatarUrl?: string | null
  createdAt: Date
  tags?: Array<{ id: string; name: string; color: string }>
  roadmaps?: Array<{ id: string; name: string; slug: string }>
}

export function MetadataSidebar({
  postId,
  voteCount,
  status,
  board,
  authorName,
  authorAvatarUrl,
  createdAt,
  tags = [],
  roadmaps = [],
}: MetadataSidebarProps) {
  // Fetch subscription status for the bell
  const { data: sidebarData } = useSuspenseQuery(portalDetailQueries.voteSidebarData(postId))

  const isMember = sidebarData?.isMember ?? false
  const subscriptionStatus = sidebarData?.subscriptionStatus ?? {
    subscribed: false,
    level: 'none' as const,
    reason: null,
  }

  return (
    <aside className="hidden lg:block w-72 shrink-0 border-l border-border/30 bg-muted/5">
      <div className="p-4 space-y-5">
        {/* Upvotes */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ChevronUpIcon className="h-4 w-4" />
            <span>Upvotes</span>
          </div>
          <AuthVoteButton postId={postId} voteCount={voteCount} disabled={!isMember} compact />
        </div>

        {/* Status */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Status</span>
          {status ? <StatusBadge name={status.name} color={status.color} /> : <NoneLabel />}
        </div>

        {/* Board */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FolderIcon className="h-4 w-4" />
            <span>Board</span>
          </div>
          <span className="text-sm font-medium text-foreground">{board.name}</span>
        </div>

        {/* Tags */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <TagIcon className="h-4 w-4" />
            <span>Tags</span>
          </div>
          {tags.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-1 max-w-[60%]">
              {tags.map((tag) => (
                <Badge key={tag.id} variant="secondary" className="text-[11px] font-normal">
                  {tag.name}
                </Badge>
              ))}
            </div>
          ) : (
            <NoneLabel />
          )}
        </div>

        {/* Roadmaps */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapIcon className="h-4 w-4" />
            <span>Roadmap</span>
          </div>
          {roadmaps.length > 0 ? (
            <div className="flex flex-col items-end gap-1">
              {roadmaps.map((roadmap) => (
                <Link
                  key={roadmap.id}
                  to="/roadmap"
                  className="text-sm font-medium text-foreground hover:text-primary transition-colors"
                >
                  {roadmap.name}
                </Link>
              ))}
            </div>
          ) : (
            <NoneLabel />
          )}
        </div>

        {/* Date */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarIcon className="h-4 w-4" />
            <span>Date</span>
          </div>
          <TimeAgo date={createdAt} className="text-sm text-foreground" />
        </div>

        {/* Author */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <UserIcon className="h-4 w-4" />
            <span>Author</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Avatar className="h-5 w-5">
              {authorAvatarUrl && (
                <AvatarImage src={authorAvatarUrl} alt={authorName || 'Author'} />
              )}
              <AvatarFallback className="text-[9px]">{getInitials(authorName)}</AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium text-foreground">{authorName || 'Anonymous'}</span>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-border/30 pt-4">
          {/* Subscribe section */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Subscribe</span>
            <AuthSubscriptionBell
              postId={postId}
              initialStatus={subscriptionStatus}
              disabled={!isMember}
            />
          </div>
          <p className="text-xs text-muted-foreground/70 mt-2">
            Get notified when there are updates to this post
          </p>
        </div>
      </div>
    </aside>
  )
}
