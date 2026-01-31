import {
  ChevronUpIcon,
  EllipsisHorizontalIcon,
  PencilIcon,
  TrashIcon,
} from '@heroicons/react/24/solid'
import { useAuthPopover } from '@/components/auth/auth-popover-context'
import { PostListItem, type PostListItemDensity } from '@/components/shared/post-list-item'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { PostStatusEntity } from '@/lib/db-types'
import { usePostVote } from '@/lib/hooks/use-post-vote'
import { cn } from '@/lib/utils'
import type { PostId, StatusId } from '@quackback/ids'

export type { PostListItemDensity as PostCardDensity }

interface PostCardProps {
  id: PostId
  title: string
  content: string
  statusId: StatusId | null
  statuses: PostStatusEntity[]
  voteCount: number
  commentCount: number
  authorName: string | null
  /** Avatar URL for the author (base64 data URL or external URL) */
  authorAvatarUrl?: string | null
  createdAt: Date
  boardSlug: string
  boardName?: string
  tags: { id: string; name: string; color: string }[]
  /** Whether the user is authenticated (shows login dialog on vote if false) */
  isAuthenticated?: boolean
  /** Whether the current user is the author of this post */
  isCurrentUserAuthor?: boolean
  /** Whether the user can edit this post */
  canEdit?: boolean
  /** Whether the user can delete this post */
  canDelete?: boolean
  /** Reason why editing is not allowed (shown in tooltip) */
  editReason?: string
  /** Reason why deletion is not allowed (shown in tooltip) */
  deleteReason?: string
  /** Callback when user clicks edit */
  onEdit?: () => void
  /** Callback when user clicks delete */
  onDelete?: () => void
  /** Display density: comfortable (default) or compact */
  density?: PostListItemDensity
}

export function PostCard({
  id,
  title,
  content,
  statusId,
  statuses,
  voteCount,
  commentCount,
  authorName,
  authorAvatarUrl,
  createdAt,
  boardSlug,
  boardName,
  tags,
  isAuthenticated = true,
  isCurrentUserAuthor = false,
  canEdit = false,
  canDelete = false,
  editReason,
  deleteReason,
  onEdit,
  onDelete,
  density = 'comfortable',
}: PostCardProps): React.ReactElement {
  const { openAuthPopover } = useAuthPopover()
  const {
    voteCount: currentVoteCount,
    hasVoted: currentHasVoted,
    isPending,
    handleVote,
  } = usePostVote({ postId: id, voteCount })

  function handleVoteClick(e: React.MouseEvent): void {
    if (!isAuthenticated) {
      e.preventDefault()
      e.stopPropagation()
      openAuthPopover({ mode: 'login' })
      return
    }
    handleVote(e)
  }

  const isCompact = density === 'compact'

  return (
    <PostListItem
      post={{
        id,
        title,
        content,
        statusId,
        voteCount: currentVoteCount,
        commentCount,
        authorName,
        authorAvatarUrl,
        createdAt,
        boardSlug,
        boardName,
        tags,
      }}
      statuses={statuses}
      density={density}
      showAvatar={true}
      renderVoteButton={({ className }) => (
        <button
          type="button"
          data-testid="vote-button"
          aria-label={
            currentHasVoted
              ? `Remove vote (${currentVoteCount} votes)`
              : `Vote for this post (${currentVoteCount} votes)`
          }
          aria-pressed={currentHasVoted}
          onClick={handleVoteClick}
          disabled={isPending}
          className={cn(
            className,
            'post-card__vote group rounded-lg border transition-all duration-200',
            isCompact ? 'mx-2' : 'mx-3',
            currentHasVoted
              ? 'post-card__vote--voted text-[var(--post-card-voted-color)] bg-[var(--post-card-voted-color)]/10 border-[var(--post-card-voted-color)]/30'
              : 'text-muted-foreground bg-muted/40 border-border/50 hover:bg-muted/60 hover:border-border',
            isPending && 'opacity-70 cursor-wait'
          )}
        >
          <ChevronUpIcon
            className={cn(
              'transition-transform duration-200',
              isCompact ? 'h-4 w-4' : 'h-5 w-5',
              currentHasVoted && 'fill-[var(--post-card-voted-color)]',
              !isPending && 'group-hover:-translate-y-0.5'
            )}
          />
          <span
            data-testid="vote-count"
            className={cn(
              'font-semibold tabular-nums',
              isCompact ? 'text-sm' : 'text-base',
              !currentHasVoted && 'text-foreground'
            )}
          >
            {currentVoteCount}
          </span>
        </button>
      )}
      renderQuickActions={
        isCurrentUserAuthor
          ? () => (
              <TooltipProvider>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => e.preventDefault()}
                      className="p-1 -m-1 rounded hover:bg-muted/50 transition-colors"
                      aria-label="Post options"
                    >
                      <EllipsisHorizontalIcon className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.preventDefault()}>
                    {canEdit ? (
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.preventDefault()
                          onEdit?.()
                        }}
                      >
                        <PencilIcon className="h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuItem disabled>
                            <PencilIcon className="h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          <p>{editReason || 'Edit not allowed'}</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {canDelete ? (
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={(e) => {
                          e.preventDefault()
                          onDelete?.()
                        }}
                      >
                        <TrashIcon className="h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuItem disabled>
                            <TrashIcon className="h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          <p>{deleteReason || 'Delete not allowed'}</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TooltipProvider>
            )
          : undefined
      }
      className={cn('py-1', isCompact ? 'px-2' : 'px-3')}
    />
  )
}
