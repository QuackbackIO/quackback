import { useEffect, useState } from 'react'
import {
  ArrowUturnLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FaceSmileIcon,
  MapPinIcon,
} from '@heroicons/react/24/solid'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TimeAgo } from '@/components/ui/time-ago'
import { REACTION_EMOJIS } from '@/lib/shared/db-types'
import { addReactionFn, removeReactionFn } from '@/lib/server/functions/comments'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { getInitials, cn } from '@/lib/shared/utils'
import type { PublicCommentView } from '@/lib/client/queries/portal-detail'
import type { CommentReactionCount } from '@/lib/shared'

const MAX_WIDGET_DEPTH = 2

interface WidgetCommentListProps {
  comments: PublicCommentView[]
  pinnedCommentId: string | null
  canComment?: boolean
  onSubmitComment?: (content: string, parentId: string) => Promise<void>
}

export function WidgetCommentList({
  comments,
  pinnedCommentId,
  canComment = false,
  onSubmitComment,
}: WidgetCommentListProps) {
  const sortedComments = [...comments].sort((a, b) => {
    if (pinnedCommentId) {
      if (a.id === pinnedCommentId) return -1
      if (b.id === pinnedCommentId) return 1
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  if (comments.length === 0) {
    return (
      <p className="text-xs text-muted-foreground/60 text-center py-4">
        No comments yet. Be the first to share your thoughts!
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {sortedComments.map((comment) => (
        <WidgetCommentItem
          key={comment.id}
          comment={comment}
          pinnedCommentId={pinnedCommentId}
          depth={0}
          canComment={canComment}
          onSubmitComment={onSubmitComment}
        />
      ))}
    </div>
  )
}

interface WidgetCommentItemProps {
  comment: PublicCommentView
  pinnedCommentId: string | null
  depth: number
  canComment: boolean
  onSubmitComment?: (content: string, parentId: string) => Promise<void>
}

function WidgetCommentItem({
  comment,
  pinnedCommentId,
  depth,
  canComment,
  onSubmitComment,
}: WidgetCommentItemProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [reactions, setReactions] = useState<CommentReactionCount[]>(comment.reactions)
  const [reactionPending, setReactionPending] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

  useEffect(() => {
    setReactions(comment.reactions)
  }, [comment.reactions])

  const isDeleted = !!comment.deletedAt
  const isPinned = pinnedCommentId === comment.id
  const hasReplies = comment.replies.length > 0
  const canShowReplies = depth < MAX_WIDGET_DEPTH

  async function handleReaction(emoji: string) {
    setShowEmojiPicker(false)
    setReactionPending(true)
    try {
      const hasReacted = reactions.some((r) => r.emoji === emoji && r.hasReacted)
      const fn = hasReacted ? removeReactionFn : addReactionFn
      const result = await fn({
        data: { commentId: comment.id, emoji },
        headers: getWidgetAuthHeaders(),
      })
      setReactions(result.reactions)
    } catch (error) {
      console.error('Failed to update reaction:', error)
    } finally {
      setReactionPending(false)
    }
  }

  async function handleSubmitReply() {
    const content = replyText.trim()
    if (!content || isSubmitting || !onSubmitComment) return
    setIsSubmitting(true)
    try {
      await onSubmitComment(content, comment.id)
      setReplyText('')
      setShowReplyForm(false)
    } catch {
      // Error handled by parent
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isDeleted) {
    return (
      <div
        className={cn(
          'relative',
          depth > 0 &&
            'ml-4 pl-3 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-px before:bg-border/40'
        )}
      >
        <div className="py-1.5">
          <div className="flex items-center gap-1.5">
            <Avatar className="h-5 w-5 shrink-0 opacity-40">
              <AvatarFallback className="text-[9px]">?</AvatarFallback>
            </Avatar>
            <span className="text-xs text-muted-foreground/60 italic">
              {comment.isRemovedByTeam ? '[removed]' : '[deleted]'}
            </span>
            <span className="text-muted-foreground/50 text-[10px]">&middot;</span>
            <TimeAgo date={comment.createdAt} className="text-[10px] text-muted-foreground/60" />
          </div>
          {hasReplies && (
            <div className="flex items-center gap-1 mt-1.5 ml-7">
              <button
                type="button"
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                {isCollapsed ? (
                  <ChevronRightIcon className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDownIcon className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          )}
        </div>
        {/* Animated nested replies */}
        <div
          className="grid transition-all duration-200 ease-out"
          style={{
            gridTemplateRows: !isCollapsed && hasReplies && canShowReplies ? '1fr' : '0fr',
            opacity: !isCollapsed && hasReplies && canShowReplies ? 1 : 0,
          }}
        >
          <div className="overflow-hidden">
            <div className="space-y-2">
              {comment.replies.map((reply) => (
                <WidgetCommentItem
                  key={reply.id}
                  comment={reply}
                  pinnedCommentId={pinnedCommentId}
                  depth={depth + 1}
                  canComment={canComment}
                  onSubmitComment={onSubmitComment}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative',
        depth > 0 &&
          'ml-4 pl-3 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-px before:bg-border/40'
      )}
    >
      <div
        className={cn(
          'py-1.5',
          isPinned && 'bg-primary/[0.04] border border-primary/15 rounded-md px-2 -mx-2'
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-1.5">
          <Avatar className="h-5 w-5 shrink-0">
            {comment.avatarUrl && (
              <AvatarImage src={comment.avatarUrl} alt={comment.authorName || ''} />
            )}
            <AvatarFallback className="text-[9px]">
              {getInitials(comment.authorName)}
            </AvatarFallback>
          </Avatar>
          <span className="text-xs font-medium text-foreground truncate">
            {comment.authorName || 'Anonymous'}
          </span>
          {comment.isTeamMember && (
            <span className="text-[9px] px-1 py-px rounded bg-primary/15 text-primary font-medium shrink-0">
              Team
            </span>
          )}
          {isPinned && (
            <span className="text-[9px] px-1 py-px rounded bg-primary/15 text-primary font-medium shrink-0 inline-flex items-center gap-0.5">
              <MapPinIcon className="h-2.5 w-2.5" />
              Pinned
            </span>
          )}
          <span className="text-muted-foreground/50 text-[10px]">&middot;</span>
          <TimeAgo
            date={comment.createdAt}
            className="text-[10px] text-muted-foreground/60 shrink-0"
          />
        </div>

        {/* Content */}
        <p className="text-xs text-foreground/90 whitespace-pre-wrap mt-1 ml-7 leading-relaxed">
          {comment.content}
        </p>

        {/* Actions row: collapse, reactions, emoji picker, reply */}
        <div className="flex items-center gap-1 mt-1.5 ml-7">
          {/* Collapse toggle */}
          {hasReplies && canShowReplies && (
            <button
              type="button"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            >
              {isCollapsed ? (
                <ChevronRightIcon className="h-3.5 w-3.5" />
              ) : (
                <ChevronDownIcon className="h-3.5 w-3.5" />
              )}
            </button>
          )}

          {/* Existing reactions */}
          {reactions.map((reaction) => (
            <button
              key={reaction.emoji}
              onClick={() => handleReaction(reaction.emoji)}
              disabled={reactionPending}
              className={cn(
                'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] transition-all duration-150',
                'border hover:bg-muted bg-muted/50',
                reaction.hasReacted
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground'
              )}
            >
              <span>{reaction.emoji}</span>
              <span>{reaction.count}</span>
            </button>
          ))}

          {/* Add reaction button */}
          <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={reactionPending}
                className="h-5 w-5 flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                <FaceSmileIcon className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-1.5" align="start">
              <div className="flex gap-0.5">
                {REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(emoji)}
                    className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted text-sm transition-colors"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Reply button */}
          {canComment && canShowReplies && (
            <button
              type="button"
              onClick={() => setShowReplyForm(!showReplyForm)}
              className="inline-flex items-center gap-0.5 h-5 px-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            >
              <ArrowUturnLeftIcon className="h-2.5 w-2.5" />
              Reply
            </button>
          )}
        </div>

        {/* Inline reply form — animated expand */}
        <div
          className="grid transition-all duration-200 ease-out"
          style={{
            gridTemplateRows: showReplyForm ? '1fr' : '0fr',
            opacity: showReplyForm ? 1 : 0,
          }}
        >
          <div className="overflow-hidden">
            <div className="mt-2 ml-7 p-2 bg-muted/30 rounded-md border border-border/30">
              <div className="flex gap-2">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Reply to ${comment.authorName || 'Anonymous'}...`}
                  rows={2}
                  disabled={isSubmitting}
                  autoFocus
                  className="flex-1 min-h-[44px] max-h-[100px] resize-none rounded-md border border-border/50 bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50 disabled:opacity-50 transition-colors"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      handleSubmitReply()
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={handleSubmitReply}
                  disabled={isSubmitting || !replyText.trim()}
                  className="self-end px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {isSubmitting ? '...' : 'Post'}
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowReplyForm(false)
                  setReplyText('')
                }}
                className="mt-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Animated nested replies */}
      <div
        className="grid transition-all duration-200 ease-out"
        style={{
          gridTemplateRows: !isCollapsed && hasReplies && canShowReplies ? '1fr' : '0fr',
          opacity: !isCollapsed && hasReplies && canShowReplies ? 1 : 0,
        }}
      >
        <div className="overflow-hidden">
          <div className="space-y-2 mt-1">
            {comment.replies.map((reply) => (
              <WidgetCommentItem
                key={reply.id}
                comment={reply}
                pinnedCommentId={pinnedCommentId}
                depth={depth + 1}
                canComment={canComment}
                onSubmitComment={onSubmitComment}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
