import { useState } from 'react'
import {
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChatBubbleLeftIcon,
  FaceSmileIcon,
  ArrowUturnLeftIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  ArrowPathRoundedSquareIcon,
  EllipsisVerticalIcon,
  MapPinIcon,
} from '@heroicons/react/24/solid'
import { TrashIcon } from '@heroicons/react/24/outline'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PostContent } from '@/components/public/post-content'
import { TimeAgo } from '@/components/ui/time-ago'
import { CommentForm, type CreateCommentMutation } from '@/components/public/comment-form'
import { cn } from '@/lib/utils'
import { getInitials } from '@/lib/utils/string'
import { REACTION_EMOJIS } from '@/lib/db-types'
import type {
  PostDetails,
  CommentWithReplies,
  CurrentUser,
} from '@/components/admin/feedback/inbox-types'
import type { PostId, CommentId } from '@quackback/ids'

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function countAllComments(comments: CommentWithReplies[]): number {
  let count = 0
  for (const comment of comments) {
    count += 1
    if (comment.replies && comment.replies.length > 0) {
      count += countAllComments(comment.replies)
    }
  }
  return count
}

interface CommentItemProps {
  postId: PostId
  comment: CommentWithReplies
  avatarUrls?: Record<string, string | null>
  currentUser: CurrentUser
  createComment: CreateCommentMutation
  onReaction: (commentId: string, emoji: string) => void
  isReactionPending: boolean
  depth?: number
  pinnedCommentId: string | null
  onPinComment: (commentId: string) => void
  onUnpinComment: () => void
  isPinPending: boolean
}

function CommentItem({
  postId,
  comment,
  avatarUrls,
  currentUser,
  createComment,
  onReaction,
  isReactionPending,
  depth = 0,
  pinnedCommentId,
  onPinComment,
  onUnpinComment,
  isPinPending,
}: CommentItemProps) {
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

  const maxDepth = 5
  const canNest = depth < maxDepth
  const hasReplies = comment.replies && comment.replies.length > 0
  const reactions = comment.reactions || []
  const isPinned = pinnedCommentId === comment.id
  // Can pin: team member, root-level comment (no parent), not deleted
  const canPin = comment.isTeamMember && !comment.parentId && depth === 0

  const handleReaction = (emoji: string) => {
    setShowEmojiPicker(false)
    onReaction(comment.id, emoji)
  }

  // Measurements for tree line alignment
  const replyIndent = 34
  const trunkLeft = 19 // Center of avatar (20px) minus half line width (1px)

  return (
    <div className="relative">
      {/* Vertical trunk line - at avatar center, runs full height when has replies */}
      {hasReplies && !isCollapsed && (
        <div
          className="absolute top-10 bottom-0 w-[2px] bg-muted pointer-events-none"
          style={{ left: trunkLeft }}
          aria-hidden="true"
        />
      )}

      {/* Main comment row */}
      <div className="relative flex gap-3">
        {/* Avatar */}
        <div className="relative shrink-0 w-10">
          <Avatar className="relative h-10 w-10 ring-2 ring-background shadow-md z-10">
            {comment.memberId && avatarUrls?.[comment.memberId] && (
              <AvatarImage
                src={avatarUrls[comment.memberId]!}
                alt={comment.authorName || 'Comment author'}
              />
            )}
            <AvatarFallback className="text-sm bg-primary/20 text-primary font-semibold">
              {getInitials(comment.authorName)}
            </AvatarFallback>
          </Avatar>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 pb-2">
          {/* Header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-foreground">
                {comment.authorName || 'Anonymous'}
              </span>
              {comment.isTeamMember && (
                <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground">
                  <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                </span>
              )}
              {isPinned && (
                <Badge className="text-[10px] px-1.5 py-0 bg-primary/15 text-primary border-0">
                  <MapPinIcon className="h-2.5 w-2.5 mr-0.5" />
                  Pinned
                </Badge>
              )}
              <span className="text-muted-foreground/40">·</span>
              <span className="text-sm text-muted-foreground/60">
                <TimeAgo date={comment.createdAt} />
              </span>
            </div>
            {/* Actions dropdown for team comments */}
            {canPin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-60 hover:opacity-100"
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
                      onClick={() => onPinComment(comment.id)}
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

          {/* Content */}
          <p className="text-sm whitespace-pre-wrap mt-1.5 text-foreground/90 leading-relaxed">
            {comment.content}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-1 mt-3">
            {reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                onClick={() => handleReaction(reaction.emoji)}
                disabled={isReactionPending}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all duration-150',
                  reaction.hasReacted
                    ? 'bg-primary/15 text-primary hover:bg-primary/20'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
              >
                <span className="text-sm leading-none">{reaction.emoji}</span>
                <span className="tabular-nums">{reaction.count}</span>
              </button>
            ))}

            <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
              <PopoverTrigger asChild>
                <button
                  className="inline-flex items-center px-2 py-1 rounded-md text-muted-foreground/60 hover:bg-muted/50 hover:text-foreground transition-all duration-150"
                  disabled={isReactionPending}
                >
                  <FaceSmileIcon className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2" align="start" sideOffset={4}>
                <div className="flex gap-1">
                  {REACTION_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => handleReaction(emoji)}
                      className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-muted text-lg transition-all duration-150 hover:scale-110"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {canNest && (
              <button
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground/60 hover:bg-muted/50 hover:text-foreground transition-all duration-150"
                onClick={() => setShowReplyForm(!showReplyForm)}
              >
                <ArrowUturnLeftIcon className="h-4 w-4" />
                <span>Reply</span>
              </button>
            )}

            {hasReplies && (
              <button
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground/60 hover:bg-muted/50 hover:text-foreground transition-all duration-150"
                onClick={() => setIsCollapsed(!isCollapsed)}
              >
                {isCollapsed ? (
                  <>
                    <ChevronRightIcon className="h-3.5 w-3.5" />
                    <span>
                      {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}
                    </span>
                  </>
                ) : (
                  <>
                    <ChevronDownIcon className="h-3.5 w-3.5" />
                    <span>Hide</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Reply form */}
          {showReplyForm && (
            <div className="mt-4 max-w-lg p-4 bg-muted/20 rounded-xl border border-border/30">
              <CommentForm
                postId={postId}
                parentId={comment.id as CommentId}
                user={currentUser}
                createComment={createComment}
                onSuccess={() => setShowReplyForm(false)}
                onCancel={() => setShowReplyForm(false)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Nested replies */}
      {!isCollapsed && hasReplies && (
        <div className="relative" style={{ marginLeft: replyIndent }}>
          {comment.replies.map((reply, index) => {
            const isLast = index === comment.replies.length - 1
            return (
              <div key={reply.id} className="relative pt-3">
                {/* L-shaped connector */}
                <div
                  className="absolute pointer-events-none z-10"
                  style={{
                    left: -15,
                    top: 1,
                    width: 17,
                    height: 32,
                  }}
                  aria-hidden="true"
                >
                  <div className="w-full h-full border-l-2 border-b-2 border-border/50 rounded-bl-xl" />
                </div>

                {/* Background mask to hide trunk line below last reply */}
                {isLast && (
                  <div
                    className="absolute bg-background"
                    style={{
                      left: -16,
                      top: 20,
                      bottom: 0,
                      width: 4,
                    }}
                    aria-hidden="true"
                  />
                )}

                <CommentItem
                  postId={postId}
                  comment={reply}
                  avatarUrls={avatarUrls}
                  currentUser={currentUser}
                  createComment={createComment}
                  onReaction={onReaction}
                  isReactionPending={isReactionPending}
                  depth={depth + 1}
                  pinnedCommentId={pinnedCommentId}
                  onPinComment={onPinComment}
                  onUnpinComment={onUnpinComment}
                  isPinPending={isPinPending}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface DetailContentProps {
  post: PostDetails
  avatarUrls?: Record<string, string | null>
  currentUser: CurrentUser
  createComment: CreateCommentMutation
  onReaction: (commentId: string, emoji: string) => void
  isReactionPending: boolean
  onVote: () => void
  isVotePending: boolean
  onRestore?: () => Promise<void>
  onPermanentDelete?: () => Promise<void>
  onPinComment: (commentId: string) => void
  onUnpinComment: () => void
  isPinPending: boolean
}

function useAsyncAction(action?: () => Promise<void>): [boolean, () => Promise<void>] {
  const [isPending, setIsPending] = useState(false)
  const execute = async () => {
    if (!action) return
    setIsPending(true)
    try {
      await action()
    } finally {
      setIsPending(false)
    }
  }
  return [isPending, execute]
}

export function DetailContent({
  post,
  avatarUrls,
  currentUser,
  createComment,
  onReaction,
  isReactionPending,
  onVote,
  isVotePending,
  onRestore,
  onPermanentDelete,
  onPinComment,
  onUnpinComment,
  isPinPending,
}: DetailContentProps) {
  const [isRestoring, handleRestore] = useAsyncAction(onRestore)
  const [isPermanentlyDeleting, handlePermanentDelete] = useAsyncAction(onPermanentDelete)
  const isActionPending = isRestoring || isPermanentlyDeleting

  return (
    <div className="flex-1 min-w-0 overflow-y-auto">
      {/* Deleted post alert */}
      {post.deletedAt && (
        <Alert variant="destructive" className="m-6 rounded-lg">
          <ExclamationTriangleIcon className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>
              This post was deleted
              {post.deletedByMemberName ? ` by ${post.deletedByMemberName}` : ''}
              {' on '}
              {formatDate(new Date(post.deletedAt))}.
            </span>
            <div className="flex items-center gap-2 ml-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRestore}
                disabled={isActionPending || !onRestore}
                className="bg-background hover:bg-muted"
              >
                {isRestoring ? (
                  <ArrowPathIcon className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <ArrowPathRoundedSquareIcon className="h-3.5 w-3.5 mr-1.5" />
                )}
                Restore
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handlePermanentDelete}
                disabled={isActionPending || !onPermanentDelete}
              >
                {isPermanentlyDeleting ? (
                  <ArrowPathIcon className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <TrashIcon className="h-3.5 w-3.5 mr-1.5" />
                )}
                Delete Permanently
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Main content */}
      <div className="flex border-b border-border/30">
        {/* Vote column */}
        <div className="flex flex-col items-center justify-start py-6 px-6 border-r border-border/30 bg-muted/10">
          <button
            type="button"
            onClick={onVote}
            disabled={isVotePending}
            className={cn(
              'group flex flex-col items-center justify-center py-3 px-4 rounded-xl transition-all duration-200 cursor-pointer',
              'border-2',
              post.hasVoted
                ? 'bg-primary/10 border-primary/30 text-primary shadow-sm shadow-primary/10'
                : 'bg-muted/30 border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border/50',
              isVotePending && 'opacity-70 cursor-wait'
            )}
          >
            <ChevronUpIcon
              className={cn(
                'h-5 w-5 transition-transform duration-200',
                post.hasVoted && 'fill-primary',
                !isVotePending && 'group-hover:-translate-y-0.5'
              )}
            />
            <span
              className={cn(
                'text-xl font-semibold tabular-nums mt-0.5',
                post.hasVoted ? 'text-primary' : 'text-foreground'
              )}
            >
              {post.voteCount}
            </span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 p-6">
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground tracking-tight mb-3">
            {post.title}
          </h1>

          <div className="flex items-center gap-2 text-sm mb-5">
            <span className="font-medium text-foreground/85">{post.authorName || 'Anonymous'}</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground/70">
              <TimeAgo date={post.createdAt} />
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted/40 text-xs font-medium text-foreground/70">
              {post.board.name}
            </span>
          </div>

          <PostContent
            content={post.content}
            contentJson={post.contentJson}
            className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-foreground/85 leading-relaxed"
          />

          {/* Legacy Official Response (read-only - will be migrated to pinned comments) */}
          {post.officialResponse && !post.pinnedComment && (
            <div className="mt-8 pt-6 border-t border-border/30">
              <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/8 to-primary/4 p-5 shadow-sm">
                <div className="flex items-center gap-2.5 flex-wrap mb-3">
                  <Badge className="text-xs px-2.5 py-1 bg-primary/15 text-primary border-0 font-semibold uppercase tracking-wide">
                    Official Response
                  </Badge>
                  {post.officialResponse.authorName && (
                    <span className="text-xs text-muted-foreground/80 font-medium">
                      by {post.officialResponse.authorName}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground/60">
                    · <TimeAgo date={post.officialResponse.respondedAt} />
                  </span>
                </div>
                <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                  {post.officialResponse.content}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Comments */}
      <div className="p-6">
        <div className="flex items-center gap-2 mb-5">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/30">
            <ChatBubbleLeftIcon className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
              {countAllComments(post.comments)}{' '}
              {countAllComments(post.comments) === 1 ? 'Comment' : 'Comments'}
            </span>
          </div>
        </div>

        <div className="mb-6">
          <CommentForm postId={post.id} user={currentUser} createComment={createComment} />
        </div>

        {post.comments.length > 0 ? (
          <div className="space-y-1">
            {[...post.comments]
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map((comment) => (
                <CommentItem
                  key={comment.id}
                  postId={post.id}
                  comment={comment}
                  avatarUrls={avatarUrls}
                  currentUser={currentUser}
                  createComment={createComment}
                  onReaction={onReaction}
                  isReactionPending={isReactionPending}
                  pinnedCommentId={post.pinnedCommentId}
                  onPinComment={onPinComment}
                  onUnpinComment={onUnpinComment}
                  isPinPending={isPinPending}
                />
              ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 px-4">
            <div className="w-12 h-12 rounded-full bg-muted/40 flex items-center justify-center mb-3">
              <ChatBubbleLeftIcon className="h-5 w-5 text-muted-foreground/40" />
            </div>
            <p className="text-sm text-muted-foreground/70 text-center">
              No comments yet. Be the first to share your thoughts!
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
