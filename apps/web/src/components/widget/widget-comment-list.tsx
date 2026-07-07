import { useEffect, useRef, useState } from 'react'
import {
  ArrowUturnLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FaceSmileIcon,
  MapPinIcon,
} from '@heroicons/react/24/solid'
import { useIntl, FormattedMessage } from 'react-intl'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TimeAgo } from '@/components/ui/time-ago'
import { REACTION_EMOJIS } from '@/lib/shared/db-types'
import { ReactionChip } from '@/components/shared/reaction-chip'
import { addReactionFn, removeReactionFn } from '@/lib/server/functions/comments'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { getInitials, cn } from '@/lib/shared/utils'
import { CommentContent } from '@/components/public/comment-content'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { COMMENT_EDITOR_FEATURES } from '@/components/public/comment-editor-features'
import type { PublicCommentView } from '@/lib/client/queries/portal-detail'
import type { CommentReactionCount } from '@/lib/shared'
import type { TiptapContent } from '@/lib/shared/db-types'

const MAX_WIDGET_DEPTH = 2

interface WidgetCommentListProps {
  comments: PublicCommentView[]
  pinnedCommentId: string | null
  canComment?: boolean
  onSubmitComment?: (
    content: string,
    contentJson: TiptapContent | null,
    parentId: string
  ) => Promise<void>
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
        <FormattedMessage
          id="widget.commentList.empty"
          defaultMessage="No comments yet. Be the first to share your thoughts!"
        />
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
  onSubmitComment?: (
    content: string,
    contentJson: TiptapContent | null,
    parentId: string
  ) => Promise<void>
}

function WidgetCommentItem({
  comment,
  pinnedCommentId,
  depth,
  canComment,
  onSubmitComment,
}: WidgetCommentItemProps) {
  const intl = useIntl()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [replyText, setReplyText] = useState('')
  const replyJsonRef = useRef<TiptapContent | null>(null)
  const [replyResetKey, setReplyResetKey] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [reactions, setReactions] = useState<CommentReactionCount[]>(comment.reactions)
  const [reactionPending, setReactionPending] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

  useEffect(() => {
    setReactions(comment.reactions)
  }, [comment.reactions])

  useEffect(() => {
    if (!showReplyForm) return
    // Reset the editor each time the reply form opens so a previously
    // typed-but-cancelled draft doesn't leak into the next reply.
    setReplyText('')
    replyJsonRef.current = null
    setReplyResetKey((k) => k + 1)
  }, [showReplyForm])

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
      await onSubmitComment(content, replyJsonRef.current, comment.id)
      setReplyText('')
      replyJsonRef.current = null
      setReplyResetKey((k) => k + 1)
      setShowReplyForm(false)
    } catch {
      // Error handled by parent
    } finally {
      setIsSubmitting(false)
    }
  }

  const authorName =
    comment.authorName ||
    intl.formatMessage({ id: 'widget.commentList.authorFallback', defaultMessage: 'Anonymous' })

  if (isDeleted) {
    return (
      <div
        className={cn(
          'relative',
          depth > 0 &&
            'ms-4 ps-3 before:absolute before:start-0 before:top-0 before:bottom-0 before:w-px before:bg-border/40'
        )}
      >
        <div className="py-1.5">
          <div className="flex items-center gap-1.5">
            <Avatar className="h-5 w-5 shrink-0 opacity-40">
              <AvatarFallback className="text-[9px]">?</AvatarFallback>
            </Avatar>
            <span className="text-xs text-muted-foreground/60 italic">
              {comment.isRemovedByTeam ? (
                <FormattedMessage id="widget.commentList.removed" defaultMessage="[removed]" />
              ) : (
                <FormattedMessage id="widget.commentList.deleted" defaultMessage="[deleted]" />
              )}
            </span>
            <span className="text-muted-foreground/50 text-[10px]">&middot;</span>
            <TimeAgo date={comment.createdAt} className="text-[10px] text-muted-foreground/60" />
          </div>
          {hasReplies && (
            <div className="flex items-center gap-1 mt-1.5 ms-7">
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
          'ms-4 ps-3 before:absolute before:start-0 before:top-0 before:bottom-0 before:w-px before:bg-border/40'
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
          <span className="text-xs font-medium text-foreground truncate">{authorName}</span>
          {comment.isTeamMember && (
            <span className="text-[11px] px-1 py-px rounded bg-primary/15 text-primary font-medium shrink-0">
              <FormattedMessage id="widget.commentList.teamBadge" defaultMessage="Team" />
            </span>
          )}
          {isPinned && (
            <span className="text-[11px] px-1 py-px rounded bg-primary/15 text-primary font-medium shrink-0 inline-flex items-center gap-0.5">
              <MapPinIcon className="h-2.5 w-2.5" />
              <FormattedMessage id="widget.commentList.pinnedBadge" defaultMessage="Pinned" />
            </span>
          )}
          <span className="text-muted-foreground/50 text-[10px]">&middot;</span>
          <TimeAgo
            date={comment.createdAt}
            className="text-[10px] text-muted-foreground/60 shrink-0"
          />
        </div>

        {/* Content */}
        <CommentContent
          content={comment.content}
          contentJson={comment.contentJson ?? null}
          className="text-xs text-foreground/90 mt-1 ms-7 leading-relaxed"
        />

        {/* Actions row: collapse, reactions, emoji picker, reply */}
        <div className="flex items-center gap-1 mt-1.5 ms-7">
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

          {/* Existing reactions — hover shows who reacted. */}
          {reactions.map((reaction) => (
            <ReactionChip
              key={reaction.emoji}
              emoji={reaction.emoji}
              count={reaction.count}
              hasReacted={reaction.hasReacted}
              reactors={reaction.reactors}
              disabled={reactionPending}
              onToggle={() => handleReaction(reaction.emoji)}
            />
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
              className="inline-flex items-center gap-0.5 h-5 px-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            >
              <ArrowUturnLeftIcon className="h-2.5 w-2.5" />
              <FormattedMessage id="widget.commentList.reply" defaultMessage="Reply" />
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
            <div className="mt-2 ms-7 p-2 bg-muted/30 rounded-md border border-border/30">
              <div
                data-testid="widget-reply-editor"
                className="rounded-md border border-border/50 bg-background px-2.5 py-1.5"
                onKeyDownCapture={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void handleSubmitReply()
                  }
                }}
              >
                <RichTextEditor
                  key={replyResetKey}
                  value={replyText}
                  borderless
                  minHeight="44px"
                  features={COMMENT_EDITOR_FEATURES}
                  disabled={isSubmitting}
                  placeholder={intl.formatMessage(
                    {
                      id: 'widget.commentList.replyPlaceholder',
                      defaultMessage: 'Reply to {name}...',
                    },
                    { name: authorName }
                  )}
                  onChange={(json, _html, markdown) => {
                    replyJsonRef.current = json as TiptapContent
                    setReplyText(markdown ?? '')
                  }}
                />
              </div>
              <div className="flex items-center justify-between mt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowReplyForm(false)
                    setReplyText('')
                    replyJsonRef.current = null
                  }}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <FormattedMessage id="widget.commentList.cancel" defaultMessage="Cancel" />
                </button>
                <button
                  type="button"
                  onClick={handleSubmitReply}
                  disabled={isSubmitting || !replyText.trim()}
                  className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {isSubmitting ? (
                    '...'
                  ) : (
                    <FormattedMessage id="widget.commentList.post" defaultMessage="Post" />
                  )}
                </button>
              </div>
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
