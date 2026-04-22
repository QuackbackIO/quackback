import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import {
  ArrowRightIcon,
  ArrowUturnLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FaceSmileIcon,
  LockClosedIcon,
  MapPinIcon,
} from '@heroicons/react/24/solid'
import { PencilSquareIcon, TrashIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TimeAgo } from '@/components/ui/time-ago'
import { REACTION_EMOJIS } from '@/lib/shared/db-types'
import { addReactionFn, removeReactionFn } from '@/lib/server/functions/comments'
import { useEditComment } from '@/lib/client/mutations/portal-comments'
import type { CommentReactionCount } from '@/lib/shared'
import type { PublicCommentView } from '@/lib/client/queries/portal-detail'
import { cn, getInitials } from '@/lib/shared/utils'
import { StatusBadge } from '@/components/ui/status-badge'
import { CommentForm, type CreateCommentMutation } from './comment-form'
import type { CommentId, PostId, PrincipalId } from '@quackback/ids'

/**
 * Groups root-level comments so consecutive private comments are wrapped
 * in a single PrivateNoteCard. Public comments render individually.
 */
function renderGroupedComments(
  comments: PublicCommentView[],
  itemProps: Omit<CommentItemProps, 'comment' | 'depth' | 'insidePrivateCard'>
) {
  const groups: Array<
    | { type: 'public'; comment: PublicCommentView }
    | { type: 'private'; comments: PublicCommentView[] }
  > = []

  for (const comment of comments) {
    if (comment.isPrivate) {
      const lastGroup = groups[groups.length - 1]
      if (lastGroup?.type === 'private') {
        lastGroup.comments.push(comment)
      } else {
        groups.push({ type: 'private', comments: [comment] })
      }
    } else {
      groups.push({ type: 'public', comment })
    }
  }

  return groups.map((group, i) => {
    if (group.type === 'public') {
      return <CommentItem key={group.comment.id} {...itemProps} comment={group.comment} />
    }

    return (
      <PrivateNoteCard key={`private-group-${i}`}>
        {group.comments.map((comment) => (
          <CommentItem key={comment.id} {...itemProps} comment={comment} insidePrivateCard />
        ))}
      </PrivateNoteCard>
    )
  })
}

function PrivateNoteCard({ children }: { children: React.ReactNode }) {
  const intl = useIntl()
  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] dark:bg-amber-950/30 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-amber-500/20 bg-amber-500/[0.06] dark:bg-amber-500/[0.08]">
        <LockClosedIcon className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
          {intl.formatMessage({
            id: 'portal.commentThread.internalNote',
            defaultMessage: 'Internal note',
          })}
        </span>
        <span className="text-xs text-amber-600/60 dark:text-amber-500/50">
          &middot;{' '}
          {intl.formatMessage({
            id: 'portal.commentThread.internalNoteHint',
            defaultMessage: 'only visible to your team',
          })}
        </span>
      </div>
      <div className="px-3 py-1 space-y-0">{children}</div>
    </div>
  )
}

interface CommentThreadProps {
  postId: PostId
  comments: PublicCommentView[]
  allowCommenting?: boolean
  user?: { name: string | null; email: string; principalId?: PrincipalId }
  /** Logo URL for the team badge (from branding settings) */
  teamBadgeLogoUrl?: string
  /** Message to show when comments are locked (overrides "Sign in to comment") */
  lockedMessage?: string
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
  // Status change props (admin only)
  /** Available statuses for the comment form status selector */
  statuses?: Array<{ id: string; name: string; color: string }>
  /** Current post status ID */
  currentStatusId?: string | null
  /** Whether the current user is a team member */
  isTeamMember?: boolean
  /** Hide the comment form area entirely (for readonly previews) */
  hideCommentForm?: boolean
  /** Callback when a comment is deleted */
  onDeleteComment?: (commentId: CommentId) => void
  /** ID of the comment currently being deleted (for loading state) */
  deletingCommentId?: CommentId | null
  /** Callback when a comment is restored (team only) */
  onRestoreComment?: (commentId: CommentId) => void
  /** ID of the comment currently being restored */
  restoringCommentId?: CommentId | null
}

export function CommentThread({
  postId,
  comments,
  allowCommenting = true,
  user,
  teamBadgeLogoUrl,
  lockedMessage,
  onAuthRequired,
  createComment,
  pinnedCommentId,
  canPinComments = false,
  onPinComment,
  onUnpinComment,
  isPinPending = false,
  statuses,
  currentStatusId,
  isTeamMember,
  hideCommentForm = false,
  onDeleteComment,
  deletingCommentId,
  onRestoreComment,
  restoringCommentId,
}: CommentThreadProps) {
  const intl = useIntl()
  const sortedComments = [...comments].sort((a, b) => {
    // Pinned comment always first
    if (pinnedCommentId) {
      if (a.id === pinnedCommentId) return -1
      if (b.id === pinnedCommentId) return 1
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  function renderCommentArea() {
    if (hideCommentForm) return null

    if (allowCommenting) {
      return (
        <CommentForm
          postId={postId}
          user={user}
          createComment={createComment}
          statuses={statuses}
          currentStatusId={currentStatusId}
          isTeamMember={isTeamMember}
        />
      )
    }

    if (lockedMessage) {
      return (
        <div className="flex items-center justify-center gap-3 py-4 px-4 bg-muted/30 [border-radius:var(--radius)] border border-border/30">
          <LockClosedIcon className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{lockedMessage}</p>
        </div>
      )
    }

    return (
      <div className="flex items-center justify-center gap-3 py-4 px-4 bg-muted/30 [border-radius:var(--radius)] border border-border/30">
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage({
            id: 'portal.commentThread.signInToComment',
            defaultMessage: 'Sign in to comment',
          })}
        </p>
        <Button variant="outline" size="sm" onClick={onAuthRequired}>
          {intl.formatMessage({ id: 'portal.commentThread.signIn', defaultMessage: 'Sign in' })}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {renderCommentArea()}

      {comments.length === 0 ? (
        <p className="text-muted-foreground text-center py-4">
          {intl.formatMessage({
            id: 'portal.commentThread.empty',
            defaultMessage: 'No comments yet. Be the first to share your thoughts!',
          })}
        </p>
      ) : (
        <div className="space-y-4">
          {renderGroupedComments(sortedComments, {
            postId,
            allowCommenting,
            user,
            teamBadgeLogoUrl,
            createComment,
            pinnedCommentId,
            canPinComments,
            onPinComment,
            onUnpinComment,
            isPinPending,
            isTeamMember,
            onDeleteComment,
            deletingCommentId,
            onRestoreComment,
            restoringCommentId,
          })}
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
  user?: { name: string | null; email: string; principalId?: PrincipalId }
  teamBadgeLogoUrl?: string
  createComment?: CreateCommentMutation
  pinnedCommentId?: string | null
  // Admin mode props
  canPinComments?: boolean
  onPinComment?: (commentId: CommentId) => void
  onUnpinComment?: () => void
  isPinPending?: boolean
  /** Whether the current user is a team member */
  isTeamMember?: boolean
  /** Callback when a comment is deleted */
  onDeleteComment?: (commentId: CommentId) => void
  /** ID of the comment currently being deleted */
  deletingCommentId?: CommentId | null
  /** Callback when a comment is restored (team only) */
  onRestoreComment?: (commentId: CommentId) => void
  /** ID of the comment currently being restored */
  restoringCommentId?: CommentId | null
  /** Whether this comment is rendered inside a PrivateNoteCard (suppresses per-comment private styling) */
  insidePrivateCard?: boolean
}

const MAX_NESTING_DEPTH = 5

function CommentItem({
  postId,
  comment,
  allowCommenting,
  depth = 0,
  user,
  teamBadgeLogoUrl,
  createComment,
  pinnedCommentId,
  canPinComments = false,
  onPinComment,
  onUnpinComment,
  isPinPending = false,
  isTeamMember,
  onDeleteComment,
  deletingCommentId,
  onRestoreComment,
  restoringCommentId,
  insidePrivateCard = false,
}: CommentItemProps) {
  const intl = useIntl()
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [reactions, setReactions] = useState<CommentReactionCount[]>(comment.reactions)
  const [isPending, setIsPending] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(comment.content)
  const [editError, setEditError] = useState<string | null>(null)
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)

  const editMutation = useEditComment({
    commentId: comment.id as CommentId,
    postId,
  })

  useEffect(() => {
    setReactions(comment.reactions)
  }, [comment.reactions])

  useEffect(() => {
    if (isEditing) {
      editTextareaRef.current?.focus()
      editTextareaRef.current?.setSelectionRange(comment.content.length, comment.content.length)
    }
  }, [isEditing, comment.content])

  const isDeleted = !!comment.deletedAt
  const canNest = depth < MAX_NESTING_DEPTH
  const hasReplies = comment.replies.length > 0
  const isPinned = pinnedCommentId === comment.id
  // Can pin: admin mode enabled, team member comment, root-level (no parent), not deleted, not private
  const canPin =
    canPinComments &&
    comment.isTeamMember &&
    !comment.parentId &&
    depth === 0 &&
    !isDeleted &&
    !comment.isPrivate
  // Can edit/delete: not already deleted, and user is author or team member
  // Server re-checks; client heuristic avoids showing the button to unrelated users
  const isAuthor = !!user?.principalId && comment.principalId === user.principalId
  const canEdit = !isDeleted && (isTeamMember || isAuthor)
  const canDelete =
    !isDeleted &&
    !!onDeleteComment &&
    (isTeamMember || isAuthor)
  const isBeingDeleted = deletingCommentId === comment.id
  // Can restore: deleted, team member, and restore handler provided
  const canRestore = isDeleted && isTeamMember && !!onRestoreComment
  const isBeingRestored = restoringCommentId === comment.id

  async function handleReaction(emoji: string): Promise<void> {
    setShowEmojiPicker(false)
    setIsPending(true)
    try {
      const hasReacted = reactions.some((r) => r.emoji === emoji && r.hasReacted)
      const fn = hasReacted ? removeReactionFn : addReactionFn
      const result = await fn({
        data: { commentId: comment.id, emoji },
      })
      setReactions(result.reactions)
    } catch (error) {
      console.error('Failed to update reaction:', error)
    } finally {
      setIsPending(false)
    }
  }

  async function handleSaveEdit(): Promise<void> {
    const trimmed = editContent.trim()
    if (!trimmed) return
    setEditError(null)
    try {
      await editMutation.mutateAsync(trimmed)
      setIsEditing(false)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save edit')
    }
  }

  // Deleted comment placeholder (portal view - when not a team member admin)
  if (isDeleted && !isTeamMember) {
    return (
      <div
        id={`comment-${comment.id}`}
        className="group/thread scroll-mt-20 transition-colors duration-500"
      >
        <div
          className={cn(
            'relative',
            depth > 0 &&
              'ms-4 ps-4 before:absolute before:start-0 before:top-0 before:bottom-0 before:w-px before:bg-border/50'
          )}
        >
          <div className="py-2">
            <div className="flex items-center gap-2">
              <Avatar className="h-8 w-8 shrink-0 opacity-40">
                <AvatarFallback className="text-xs">?</AvatarFallback>
              </Avatar>
              <span className="text-sm text-muted-foreground italic">
                {intl.formatMessage({
                  id: 'portal.commentThread.deleted',
                  defaultMessage: '[deleted]',
                })}
              </span>
              <span className="text-muted-foreground text-xs">·</span>
              <TimeAgo date={comment.createdAt} className="text-xs text-muted-foreground" />
            </div>
            <p className="text-sm mt-1.5 ms-10 text-muted-foreground italic">
              {comment.isRemovedByTeam
                ? intl.formatMessage({
                    id: 'portal.commentThread.removed',
                    defaultMessage: '[removed]',
                  })
                : intl.formatMessage({
                    id: 'portal.commentThread.deleted',
                    defaultMessage: '[deleted]',
                  })}
            </p>
            {/* Collapse toggle for replies */}
            {hasReplies && (
              <div className="flex items-center gap-1 mt-2 ms-10">
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
              </div>
            )}
          </div>

          {/* Nested replies (still rendered for thread continuity) */}
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
                    teamBadgeLogoUrl={teamBadgeLogoUrl}
                    createComment={createComment}
                    pinnedCommentId={pinnedCommentId}
                    canPinComments={canPinComments}
                    onPinComment={onPinComment}
                    onUnpinComment={onUnpinComment}
                    isPinPending={isPinPending}
                    isTeamMember={isTeamMember}
                    onDeleteComment={onDeleteComment}
                    deletingCommentId={deletingCommentId}
                    onRestoreComment={onRestoreComment}
                    restoringCommentId={restoringCommentId}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
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
            'ms-4 ps-4 before:absolute before:start-0 before:top-0 before:bottom-0 before:w-px before:bg-border/50'
        )}
      >
        {/* Comment content — pinned highlight wraps only the comment, not replies */}
        <div
          className={cn(
            'py-2',
            isPinned && 'bg-primary/[0.04] border border-primary/15 rounded-lg px-3 -mx-3',
            isDeleted && isTeamMember && 'opacity-50'
          )}
        >
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8 shrink-0">
              {comment.avatarUrl && (
                <AvatarImage
                  src={comment.avatarUrl}
                  alt={
                    comment.authorName ||
                    intl.formatMessage({
                      id: 'portal.commentThread.authorAlt',
                      defaultMessage: 'Comment author',
                    })
                  }
                />
              )}
              <AvatarFallback className="text-xs">{getInitials(comment.authorName)}</AvatarFallback>
            </Avatar>
            <span className="font-medium text-sm">
              {comment.authorName ||
                intl.formatMessage({
                  id: 'portal.commentThread.authorFallback',
                  defaultMessage: 'Anonymous',
                })}
            </span>
            {comment.isTeamMember && (
              <Badge className="text-[10px] px-1.5 py-0 bg-primary/15 text-primary border-0">
                {teamBadgeLogoUrl ? (
                  <img
                    src={teamBadgeLogoUrl}
                    alt=""
                    className="h-2.5 w-2.5 me-0.5 rounded-sm object-contain"
                  />
                ) : null}
                {intl.formatMessage({
                  id: 'portal.commentThread.teamBadge',
                  defaultMessage: 'Team',
                })}
              </Badge>
            )}
            {comment.isPrivate && !insidePrivateCard && (
              <Badge className="text-[10px] px-1.5 py-0 bg-amber-500/15 text-amber-700 dark:text-amber-400 border-0">
                <LockClosedIcon className="h-2.5 w-2.5 me-0.5" />
                {intl.formatMessage({
                  id: 'portal.commentThread.internalNote',
                  defaultMessage: 'Internal note',
                })}
              </Badge>
            )}
            {isPinned && (
              <Badge className="text-[10px] px-1.5 py-0 bg-primary/15 text-primary border-0">
                <MapPinIcon className="h-2.5 w-2.5 me-0.5" />
                {intl.formatMessage({
                  id: 'portal.commentThread.pinnedBadge',
                  defaultMessage: 'Pinned',
                })}
              </Badge>
            )}
            <span className="text-muted-foreground text-xs">·</span>
            <TimeAgo date={comment.createdAt} className="text-xs text-muted-foreground" />
            {comment.isEdited && (
              <span className="text-xs text-muted-foreground/60">
                {intl.formatMessage({
                  id: 'portal.commentThread.edited',
                  defaultMessage: '(edited)',
                })}
              </span>
            )}
          </div>

          {/* Comment content — switches to an edit form when isEditing */}
          {isEditing ? (
            <div className="mt-1.5 ms-10">
              <textarea
                ref={editTextareaRef}
                data-testid="edit-comment-textarea"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSaveEdit()
                  else if (e.key === 'Escape') { setIsEditing(false); setEditContent(comment.content); setEditError(null) }
                }}
                rows={3}
                className="w-full max-w-lg rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {editError && <p className="text-xs text-destructive mt-1">{editError}</p>}
              <div className="flex items-center gap-2 mt-2">
                <Button
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={handleSaveEdit}
                  disabled={editMutation.isPending || !editContent.trim()}
                >
                  <CheckIcon className="h-3 w-3 me-1" />
                  {editMutation.isPending
                    ? intl.formatMessage({ id: 'portal.commentThread.saving', defaultMessage: 'Saving…' })
                    : intl.formatMessage({ id: 'portal.commentThread.save', defaultMessage: 'Save' })}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => { setIsEditing(false); setEditContent(comment.content); setEditError(null) }}
                  disabled={editMutation.isPending}
                >
                  <XMarkIcon className="h-3 w-3 me-1" />
                  {intl.formatMessage({ id: 'portal.commentThread.cancel', defaultMessage: 'Cancel' })}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm whitespace-pre-wrap mt-1.5 ms-10 text-foreground/90 leading-relaxed">
              {comment.content}
            </p>
          )}

          {/* Status change indicator */}
          {comment.statusChange && (
            <div className="flex items-center gap-1.5 ms-10 mt-1.5 text-xs text-muted-foreground">
              <ArrowRightIcon className="h-3 w-3 shrink-0" />
              <span>
                {intl.formatMessage({
                  id: 'portal.commentThread.changedStatusTo',
                  defaultMessage: 'changed status to',
                })}
              </span>
              <StatusBadge
                name={comment.statusChange.toName}
                color={comment.statusChange.toColor}
              />
            </div>
          )}

          {/* Actions row: expand/collapse, reactions, reply - always visible */}
          <div className="flex items-center gap-1 mt-2 ms-10">
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
            {!isDeleted &&
              reactions.map((reaction) => (
                <button
                  key={reaction.emoji}
                  data-testid="reaction-badge"
                  onClick={() => handleReaction(reaction.emoji)}
                  disabled={isPending}
                  className={cn(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-all duration-150',
                    'border hover:bg-muted',
                    'bg-muted/50',
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
            {!isDeleted && (
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
                        className="h-8 w-8 flex items-center justify-center rounded hover:bg-muted text-lg transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* Reply button */}
            {!isDeleted && allowCommenting && canNest && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowReplyForm(!showReplyForm)}
                data-testid="reply-button"
              >
                <ArrowUturnLeftIcon className="h-3 w-3 me-1" />
                {intl.formatMessage({ id: 'portal.commentThread.reply', defaultMessage: 'Reply' })}
              </Button>
            )}

            {/* Pin/Unpin button (admin only) */}
            {canPin && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={isPinned ? onUnpinComment : () => onPinComment?.(comment.id as CommentId)}
                disabled={isPinPending}
              >
                <MapPinIcon className="h-3 w-3 me-1" />
                {isPinned
                  ? intl.formatMessage({
                      id: 'portal.commentThread.unpin',
                      defaultMessage: 'Unpin',
                    })
                  : intl.formatMessage({ id: 'portal.commentThread.pin', defaultMessage: 'Pin' })}
              </Button>
            )}

            {/* Restore button (admin only, for deleted comments) */}
            {canRestore && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => onRestoreComment!(comment.id as CommentId)}
                disabled={isBeingRestored}
              >
                <ArrowUturnLeftIcon className="h-3 w-3 me-1" />
                {isBeingRestored
                  ? intl.formatMessage({
                      id: 'portal.commentThread.restoring',
                      defaultMessage: 'Restoring...',
                    })
                  : intl.formatMessage({
                      id: 'portal.commentThread.restore',
                      defaultMessage: 'Restore',
                    })}
              </Button>
            )}

            {/* Edit button */}
            {canEdit && !isEditing && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => { setIsEditing(true); setEditContent(comment.content) }}
              >
                <PencilSquareIcon className="h-3 w-3 me-1" />
                {intl.formatMessage({ id: 'portal.commentThread.edit', defaultMessage: 'Edit' })}
              </Button>
            )}

            {/* Delete button */}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => onDeleteComment!(comment.id as CommentId)}
                disabled={isBeingDeleted}
              >
                <TrashIcon className="h-3 w-3 me-1" />
                {isBeingDeleted
                  ? intl.formatMessage({
                      id: 'portal.commentThread.deleting',
                      defaultMessage: 'Deleting...',
                    })
                  : intl.formatMessage({
                      id: 'portal.commentThread.delete',
                      defaultMessage: 'Delete',
                    })}
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
              <div className="mt-3 ms-10 max-w-lg p-3 bg-muted/30 [border-radius:var(--radius)] border border-border/30">
                <CommentForm
                  postId={postId}
                  parentId={comment.id}
                  onSuccess={() => setShowReplyForm(false)}
                  onCancel={() => setShowReplyForm(false)}
                  user={user}
                  createComment={createComment}
                  isTeamMember={isTeamMember}
                  defaultPrivate={comment.isPrivate}
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
                  teamBadgeLogoUrl={teamBadgeLogoUrl}
                  createComment={createComment}
                  pinnedCommentId={pinnedCommentId}
                  canPinComments={canPinComments}
                  onPinComment={onPinComment}
                  onUnpinComment={onUnpinComment}
                  isPinPending={isPinPending}
                  isTeamMember={isTeamMember}
                  onDeleteComment={onDeleteComment}
                  deletingCommentId={deletingCommentId}
                  onRestoreComment={onRestoreComment}
                  restoringCommentId={restoringCommentId}
                  insidePrivateCard={insidePrivateCard}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
