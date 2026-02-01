import { useEffect, useState } from 'react'
import {
  ArrowUturnLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisVerticalIcon,
  FaceSmileIcon,
  MapPinIcon,
} from '@heroicons/react/24/solid'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TimeAgo } from '@/components/ui/time-ago'
import { REACTION_EMOJIS } from '@/lib/db-types'
import { toggleReactionFn } from '@/lib/server/functions/comments'
import type { CommentReactionCount } from '@/lib/shared'
import type { PublicCommentView } from '@/lib/client/queries/portal-detail'
import { cn, getInitials } from '@/lib/utils'
import { CommentForm, type CreateCommentMutation } from './comment-form'
import type { CommentId, PostId } from '@quackback/ids'

interface CommentThreadProps {
  postId: PostId
  comments: PublicCommentView[]
  allowCommenting?: boolean
  user?: { name: string | null; email: string }
  /** Called when unauthenticated user tries to comment */
  onAuthRequired?: () => void
  /** React Query mutation for creating comments with optimistic updates */
  createComment?: CreateCommentMutation
  /** ID of the pinned comment (for showing pinned indicator) */
  pinnedCommentId?: string | null
  // Admin mode props
  /** Enable comment pinning (admin only) */
  canPinComments?: boolean
  /** Callback when comment is pinned */
  onPinComment?: (commentId: CommentId) => void
  /** Callback when comment is unpinned */
  onUnpinComment?: () => void
  /** Whether pin/unpin is in progress */
  isPinPending?: boolean
}

export function CommentThread({
  postId,
  comments,
  allowCommenting = true,
  user,
  onAuthRequired,
  createComment,
  pinnedCommentId,
  canPinComments = false,
  onPinComment,
  onUnpinComment,
  isPinPending = false,
}: CommentThreadProps): React.ReactElement {
  const sortedComments = [...comments].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  return (
    <div className="space-y-6">
      {allowCommenting ? (
        <CommentForm postId={postId} user={user} createComment={createComment} />
      ) : (
        <div className="flex items-center justify-center gap-3 py-4 px-4 bg-muted/30 [border-radius:var(--radius)] border border-border/30">
          <p className="text-sm text-muted-foreground">Sign in to comment</p>
          <Button variant="outline" size="sm" onClick={onAuthRequired}>
            Sign in
          </Button>
        </div>
      )}

      {comments.length === 0 ? (
        <p className="text-muted-foreground text-center py-4">
          No comments yet. Be the first to share your thoughts!
        </p>
      ) : (
        <div className="space-y-4">
          {sortedComments.map((comment) => (
            <CommentItem
              key={comment.id}
              postId={postId}
              comment={comment}
              allowCommenting={allowCommenting}
              user={user}
              createComment={createComment}
              pinnedCommentId={pinnedCommentId}
              canPinComments={canPinComments}
              onPinComment={onPinComment}
              onUnpinComment={onUnpinComment}
              isPinPending={isPinPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface CommentItemProps {
  postId: PostId
  comment: PublicCommentView
  allowCommenting: boolean
  depth?: number
  user?: { name: string | null; email: string }
  createComment?: CreateCommentMutation
  pinnedCommentId?: string | null
  // Admin mode props
  canPinComments?: boolean
  onPinComment?: (commentId: CommentId) => void
  onUnpinComment?: () => void
  isPinPending?: boolean
}

const MAX_NESTING_DEPTH = 5

function CommentItem({
  postId,
  comment,
  allowCommenting,
  depth = 0,
  user,
  createComment,
  pinnedCommentId,
  canPinComments = false,
  onPinComment,
  onUnpinComment,
  isPinPending = false,
}: CommentItemProps): React.ReactElement {
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [reactions, setReactions] = useState<CommentReactionCount[]>(comment.reactions)
  const [isPending, setIsPending] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

  useEffect(() => {
    setReactions(comment.reactions)
  }, [comment.reactions])

  const canNest = depth < MAX_NESTING_DEPTH
  const hasReplies = comment.replies.length > 0
  const isPinned = pinnedCommentId === comment.id
  // Can pin: admin mode enabled, team member comment, root-level (no parent), not deleted
  const canPin = canPinComments && comment.isTeamMember && !comment.parentId && depth === 0

  async function handleReaction(emoji: string): Promise<void> {
    setShowEmojiPicker(false)
    setIsPending(true)
    try {
      const result = await toggleReactionFn({
        data: { commentId: comment.id, emoji },
      })
      setReactions(result.reactions)
    } catch (error) {
      console.error('Failed to toggle reaction:', error)
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div
      id={`comment-${comment.id}`}
      className="group/thread scroll-mt-20 transition-colors duration-500"
    >
      {/* Thread container with visual thread line */}
      <div
        className={cn(
          'relative',
          depth > 0 &&
            'ml-4 pl-4 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-px before:bg-border/50'
        )}
      >
        {/* Comment content */}
        <div className="py-2">
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8 shrink-0">
              {comment.avatarUrl && (
                <AvatarImage src={comment.avatarUrl} alt={comment.authorName || 'Comment author'} />
              )}
              <AvatarFallback className="text-xs">{getInitials(comment.authorName)}</AvatarFallback>
            </Avatar>
            <span className="font-medium text-sm">{comment.authorName || 'Anonymous'}</span>
            {comment.isTeamMember && (
              <Badge
                variant="default"
                className="bg-primary text-primary-foreground text-xs px-1.5 py-0"
              >
                Team
              </Badge>
            )}
            {isPinned && (
              <Badge className="text-[10px] px-1.5 py-0 bg-primary/15 text-primary border-0">
                <MapPinIcon className="h-2.5 w-2.5 mr-0.5" />
                Pinned
              </Badge>
            )}
            <span className="text-muted-foreground text-xs">·</span>
            <TimeAgo date={comment.createdAt} className="text-xs text-muted-foreground" />
            {/* Admin pin/unpin dropdown */}
            {canPin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-60 hover:opacity-100 ml-auto"
                  >
                    <EllipsisVerticalIcon className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isPinned ? (
                    <DropdownMenuItem onClick={onUnpinComment} disabled={isPinPending}>
                      <MapPinIcon className="h-4 w-4 mr-2" />
                      Unpin Response
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => onPinComment?.(comment.id as CommentId)}
                      disabled={isPinPending}
                    >
                      <MapPinIcon className="h-4 w-4 mr-2" />
                      Pin as Official Response
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Comment content - always visible */}
          <p className="text-sm whitespace-pre-wrap mt-1.5 ml-10 text-foreground/90 leading-relaxed">
            {comment.content}
          </p>

          {/* Actions row: expand/collapse, reactions, reply - always visible */}
          <div className="flex items-center gap-1 mt-2 ml-10">
            {/* Expand/Collapse button - first item, icon only */}
            {hasReplies && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => setIsCollapsed(!isCollapsed)}
              >
                {isCollapsed ? (
                  <ChevronRightIcon className="h-4 w-4" />
                ) : (
                  <ChevronDownIcon className="h-4 w-4" />
                )}
              </Button>
            )}

            {/* Existing reactions */}
            {reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                data-testid="reaction-badge"
                onClick={() => handleReaction(reaction.emoji)}
                disabled={isPending}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-all duration-150',
                  'border hover:bg-muted hover:scale-105',
                  reaction.hasReacted
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'bg-muted/50 border-transparent text-muted-foreground'
                )}
              >
                <span>{reaction.emoji}</span>
                <span>{reaction.count}</span>
              </button>
            ))}

            {/* Add reaction button */}
            <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                  disabled={isPending}
                  data-testid="add-reaction-button"
                >
                  <FaceSmileIcon className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2" align="start" data-testid="emoji-picker">
                <div className="flex gap-1">
                  {REACTION_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      data-testid="emoji-option"
                      onClick={() => handleReaction(emoji)}
                      className="h-8 w-8 flex items-center justify-center rounded hover:bg-muted text-lg transition-transform hover:scale-110"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {/* Reply button */}
            {allowCommenting && canNest && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowReplyForm(!showReplyForm)}
                data-testid="reply-button"
              >
                <ArrowUturnLeftIcon className="h-3 w-3 mr-1" />
                Reply
              </Button>
            )}
          </div>

          {/* Reply form */}
          <div
            className="grid transition-all duration-200 ease-out"
            style={{
              gridTemplateRows: showReplyForm ? '1fr' : '0fr',
              opacity: showReplyForm ? 1 : 0,
            }}
          >
            <div className="overflow-hidden">
              <div className="mt-3 ml-10 max-w-lg p-3 bg-muted/30 [border-radius:var(--radius)] border border-border/30">
                <CommentForm
                  postId={postId}
                  parentId={comment.id}
                  onSuccess={() => setShowReplyForm(false)}
                  onCancel={() => setShowReplyForm(false)}
                  user={user}
                  createComment={createComment}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Nested replies */}
        <div
          className="grid transition-all duration-200 ease-out"
          style={{
            gridTemplateRows: !isCollapsed && hasReplies ? '1fr' : '0fr',
            opacity: !isCollapsed && hasReplies ? 1 : 0,
          }}
        >
          <div className="overflow-hidden">
            <div className="space-y-3">
              {comment.replies.map((reply) => (
                <CommentItem
                  key={reply.id}
                  postId={postId}
                  comment={reply}
                  allowCommenting={allowCommenting}
                  depth={depth + 1}
                  user={user}
                  createComment={createComment}
                  pinnedCommentId={pinnedCommentId}
                  canPinComments={canPinComments}
                  onPinComment={onPinComment}
                  onUnpinComment={onUnpinComment}
                  isPinPending={isPinPending}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
