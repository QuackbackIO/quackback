'use client'

import { useState } from 'react'
import {
  X,
  MessageSquare,
  ExternalLink,
  Loader2,
  ChevronDown,
  ChevronRight,
  SmilePlus,
  Reply,
  Building2,
  Pencil,
  Trash2,
  Plus,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { InboxEmptyState } from './inbox-empty-state'
import { CommentForm } from '@/components/public/comment-form'
import { PostContent } from '@/components/public/post-content'
import { TimeAgo } from '@/components/ui/time-ago'
import { AddToRoadmapDropdown } from '@/components/admin/add-to-roadmap-dropdown'
import { ChevronUp } from 'lucide-react'
import { getInitials } from '@quackback/domain/utils'
import { REACTION_EMOJIS } from '@/lib/db/types'
import type { PostDetails, CommentWithReplies, CurrentUser } from './inbox-types'
import type { Tag, PostStatusEntity } from '@/lib/db/types'
import type { TagId, StatusId } from '@quackback/ids'

interface SubmitCommentParams {
  postId: string
  content: string
  parentId?: string | null
  authorName?: string | null
  authorEmail?: string | null
}

interface InboxPostDetailProps {
  workspaceId: string
  post: PostDetails | null
  isLoading: boolean
  allTags: Tag[]
  statuses: PostStatusEntity[]
  /** Map of memberId to avatar URL (base64 or external URL) */
  avatarUrls?: Record<string, string | null>
  currentUser: CurrentUser
  onClose: () => void
  onEdit: () => void
  onStatusChange: (statusId: StatusId) => Promise<void>
  onTagsChange: (tagIds: TagId[]) => Promise<void>
  onOfficialResponseChange: (response: string | null) => Promise<void>
  onRoadmapChange?: () => void
  submitComment: (params: SubmitCommentParams) => Promise<unknown>
  isCommentPending: boolean
  onReaction: (commentId: string, emoji: string) => void
  isReactionPending: boolean
  onVote: () => void
  isVotePending: boolean
  /** Callback to restore a soft-deleted post */
  onRestore?: () => Promise<void>
  /** Callback to permanently delete a post */
  onPermanentDelete?: () => Promise<void>
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

/**
 * Recursively count all comments including nested replies
 */
function countAllComments(comments: CommentWithReplies[]): number {
  let count = 0
  for (const comment of comments) {
    count += 1 // Count this comment
    if (comment.replies && comment.replies.length > 0) {
      count += countAllComments(comment.replies) // Count nested replies
    }
  }
  return count
}

function DetailSkeleton() {
  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-6 w-20" />
      </div>
      <Skeleton className="h-8 w-full" />
      <div className="flex gap-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-24" />
      </div>
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

interface CommentItemProps {
  postId: string
  comment: CommentWithReplies
  avatarUrls?: Record<string, string | null>
  currentUser: CurrentUser
  submitComment: (params: SubmitCommentParams) => Promise<unknown>
  isCommentPending: boolean
  onReaction: (commentId: string, emoji: string) => void
  isReactionPending: boolean
  depth?: number
}

function CommentItem({
  postId,
  comment,
  avatarUrls,
  currentUser,
  submitComment,
  isCommentPending,
  onReaction,
  isReactionPending,
  depth = 0,
}: CommentItemProps) {
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

  const maxDepth = 5
  const canNest = depth < maxDepth
  const hasReplies = comment.replies && comment.replies.length > 0

  // Use reactions directly from props (managed by React Query cache)
  const reactions = comment.reactions || []

  const handleReaction = (emoji: string) => {
    setShowEmojiPicker(false)
    onReaction(comment.id, emoji)
  }

  return (
    <div className="group/thread">
      <div className={cn('relative', depth > 0 && 'ml-4 pl-4')}>
        {/* Comment content */}
        <div className="py-2">
          {/* Comment header with avatar */}
          <div className="flex items-center gap-2">
            <Avatar className={cn('h-8 w-8 shrink-0')}>
              {comment.memberId && avatarUrls?.[comment.memberId] && (
                <AvatarImage
                  src={avatarUrls[comment.memberId]!}
                  alt={comment.authorName || 'Comment author'}
                />
              )}
              <AvatarFallback className={cn('text-xs')}>
                {getInitials(comment.authorName)}
              </AvatarFallback>
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
            <span className="text-muted-foreground text-xs">·</span>
            <span className="text-xs text-muted-foreground">
              {formatDate(new Date(comment.createdAt))}
            </span>
          </div>

          {/* Comment content */}
          <p className="text-sm whitespace-pre-wrap mt-1.5 ml-10 text-foreground/90 leading-relaxed">
            {comment.content}
          </p>

          {/* Actions row: expand/collapse, reactions, reply */}
          <div className="flex items-center gap-1 mt-2 ml-10">
            {/* Expand/Collapse button */}
            {hasReplies && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => setIsCollapsed(!isCollapsed)}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            )}

            {/* Existing reactions */}
            {reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                onClick={() => handleReaction(reaction.emoji)}
                disabled={isReactionPending}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors',
                  'border hover:bg-muted',
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
                  disabled={isReactionPending}
                >
                  <SmilePlus className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2" align="start">
                <div className="flex gap-1">
                  {REACTION_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
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
            {canNest && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowReplyForm(!showReplyForm)}
              >
                <Reply className="h-3 w-3 mr-1" />
                Reply
              </Button>
            )}
          </div>

          {/* Reply form */}
          {showReplyForm && (
            <div className="mt-3 ml-10 max-w-lg p-3 bg-muted/30 rounded-lg border border-border/30">
              <CommentForm
                postId={postId}
                parentId={comment.id}
                user={currentUser}
                submitComment={submitComment}
                isSubmitting={isCommentPending}
                onSuccess={() => setShowReplyForm(false)}
                onCancel={() => setShowReplyForm(false)}
              />
            </div>
          )}
        </div>

        {/* Nested replies */}
        {!isCollapsed && hasReplies && (
          <div className="space-y-0">
            {comment.replies.map((reply) => (
              <CommentItem
                key={reply.id}
                postId={postId}
                comment={reply}
                avatarUrls={avatarUrls}
                currentUser={currentUser}
                submitComment={submitComment}
                isCommentPending={isCommentPending}
                onReaction={onReaction}
                isReactionPending={isReactionPending}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function InboxPostDetail({
  workspaceId,
  post,
  isLoading,
  allTags,
  statuses,
  avatarUrls,
  currentUser,
  onClose,
  onEdit,
  onStatusChange,
  onTagsChange,
  onOfficialResponseChange,
  onRoadmapChange,
  submitComment,
  isCommentPending,
  onReaction,
  isReactionPending,
  onVote,
  isVotePending,
  onRestore,
  onPermanentDelete,
}: InboxPostDetailProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [isTagPopoverOpen, setIsTagPopoverOpen] = useState(false)
  const [isEditingResponse, setIsEditingResponse] = useState(false)
  const [responseText, setResponseText] = useState('')
  const [isRestoring, setIsRestoring] = useState(false)
  const [isPermanentlyDeleting, setIsPermanentlyDeleting] = useState(false)

  if (isLoading) {
    return (
      <div>
        <div className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border/50 px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Post Details</h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <DetailSkeleton />
      </div>
    )
  }

  if (!post) {
    return <InboxEmptyState type="no-selection" />
  }

  const handleStatusChange = async (value: string) => {
    setIsUpdating(true)
    try {
      await onStatusChange(value as StatusId)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleTagToggle = async (tagId: TagId) => {
    setIsUpdating(true)
    try {
      const currentTagIds = post.tags.map((t) => t.id)
      const newTagIds = currentTagIds.includes(tagId)
        ? currentTagIds.filter((id) => id !== tagId)
        : [...currentTagIds, tagId]
      await onTagsChange(newTagIds)
    } finally {
      setIsUpdating(false)
    }
  }

  const currentStatus = statuses.find((s) => s.id === post.statusId)

  return (
    <div>
      {/* Header */}
      <div className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border/50 px-4 py-3 flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Post Details</h2>
          <Button variant="ghost" size="sm" asChild className="h-7 px-2 text-muted-foreground">
            <a
              href={`/b/${post.board.slug}/posts/${post.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
          <Button variant="outline" size="sm" onClick={onEdit} className="gap-1.5">
            <Pencil className="h-3.5 w-3.5 shrink-0" />
            Edit post
          </Button>
          <AddToRoadmapDropdown
            workspaceId={workspaceId}
            postId={post.id}
            currentStatusId={post.statusId ?? ''}
            currentRoadmapIds={post.roadmapIds}
            statuses={statuses}
            onSuccess={onRoadmapChange}
          />
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Deleted post alert banner */}
      {post.deletedAt && (
        <Alert variant="destructive" className="mx-4 mt-4 rounded-lg">
          <AlertTriangle className="h-4 w-4" />
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
                onClick={async () => {
                  if (!onRestore) return
                  setIsRestoring(true)
                  try {
                    await onRestore()
                  } finally {
                    setIsRestoring(false)
                  }
                }}
                disabled={isRestoring || isPermanentlyDeleting || !onRestore}
                className="bg-background hover:bg-muted"
              >
                {isRestoring ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                )}
                Restore
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  if (!onPermanentDelete) return
                  setIsPermanentlyDeleting(true)
                  try {
                    await onPermanentDelete()
                  } finally {
                    setIsPermanentlyDeleting(false)
                  }
                }}
                disabled={isRestoring || isPermanentlyDeleting || !onPermanentDelete}
              >
                {isPermanentlyDeleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                )}
                Delete Permanently
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Main content area - two column layout like public view */}
      <div className="flex border-b border-border/30">
        {/* Vote section - left column */}
        <div className="flex flex-col items-center justify-start py-6 px-4 border-r border-border/30">
          <button
            type="button"
            onClick={onVote}
            disabled={isVotePending}
            className={cn(
              'flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-colors cursor-pointer',
              post.hasVoted
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              isVotePending && 'opacity-70'
            )}
          >
            <ChevronUp className={cn('h-6 w-6', post.hasVoted && 'fill-primary')} />
            <span
              className={cn(
                'text-lg font-bold',
                post.hasVoted ? 'text-primary' : 'text-foreground'
              )}
            >
              {post.voteCount}
            </span>
          </button>
        </div>

        {/* Content section */}
        <div className="flex-1 min-w-0 p-6">
          {/* Status selector */}
          <div className="flex items-center gap-1 mb-3">
            <Select
              value={post.statusId || ''}
              onValueChange={(value) => handleStatusChange(value)}
              disabled={isUpdating}
            >
              <SelectTrigger
                size="xs"
                className="border-0 bg-transparent shadow-none font-medium text-foreground hover:text-foreground/80 focus-visible:ring-0"
              >
                <SelectValue>
                  {currentStatus && (
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: currentStatus.color }}
                      />
                      {currentStatus.name}
                    </div>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                {statuses.map((status) => (
                  <SelectItem key={status.id} value={status.id} className="text-xs py-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: status.color }}
                      />
                      {status.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isUpdating && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>

          {/* Title */}
          <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-2">{post.title}</h1>

          {/* Author & time */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
            <span className="font-medium text-foreground/90">{post.authorName || 'Anonymous'}</span>
            <span className="text-muted-foreground/60">·</span>
            <TimeAgo date={post.createdAt} />
            <span className="text-muted-foreground/60">·</span>
            <span className="text-foreground/70">{post.board.name}</span>
          </div>

          {/* Tags - inline editable */}
          <div className="flex flex-wrap items-center gap-1.5 mb-4">
            {post.tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => handleTagToggle(tag.id)}
                disabled={isUpdating}
                className="group inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-normal bg-muted text-muted-foreground hover:bg-muted/80 transition-colors disabled:opacity-50"
              >
                {tag.name}
                <X className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
            {allTags.length > 0 && (
              <Popover open={isTagPopoverOpen} onOpenChange={setIsTagPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={isUpdating}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" />
                    Add tag
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="start">
                  <div className="max-h-48 overflow-y-auto">
                    {allTags
                      .filter((tag) => !post.tags.some((t) => t.id === tag.id))
                      .map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => {
                            handleTagToggle(tag.id)
                            setIsTagPopoverOpen(false)
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted/50 transition-colors text-left"
                        >
                          {tag.name}
                        </button>
                      ))}
                    {allTags.filter((tag) => !post.tags.some((t) => t.id === tag.id)).length ===
                      0 && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">All tags applied</p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>

          {/* Post content */}
          <PostContent
            content={post.content}
            contentJson={post.contentJson}
            className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-foreground/90"
          />

          {/* Official response section - below description */}
          <div className="mt-6 pt-6 border-t border-border/30">
            {post.officialResponse ? (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="text-[10px] px-1.5 py-0">Official Response</Badge>
                    {post.officialResponse.authorName && (
                      <span className="text-xs text-muted-foreground">
                        by {post.officialResponse.authorName}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      · <TimeAgo date={post.officialResponse.respondedAt} />
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setResponseText(post.officialResponse?.content || '')
                        setIsEditingResponse(true)
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={async () => {
                        setIsUpdating(true)
                        try {
                          await onOfficialResponseChange(null)
                        } finally {
                          setIsUpdating(false)
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {isEditingResponse ? (
                  <div className="space-y-3">
                    <Textarea
                      value={responseText}
                      onChange={(e) => setResponseText(e.target.value)}
                      placeholder="Update your official response..."
                      rows={3}
                      className="resize-none text-sm"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={isUpdating || !responseText.trim()}
                        onClick={async () => {
                          setIsUpdating(true)
                          try {
                            await onOfficialResponseChange(responseText.trim())
                            setIsEditingResponse(false)
                          } finally {
                            setIsUpdating(false)
                          }
                        }}
                      >
                        {isUpdating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Update
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIsEditingResponse(false)
                          setResponseText(post.officialResponse?.content || '')
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                    {post.officialResponse.content}
                  </p>
                )}
              </div>
            ) : isEditingResponse ? (
              <div className="space-y-3">
                <Textarea
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  placeholder="Write your official response to this feedback..."
                  rows={3}
                  className="resize-none text-sm"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={isUpdating || !responseText.trim()}
                    onClick={async () => {
                      setIsUpdating(true)
                      try {
                        await onOfficialResponseChange(responseText.trim())
                        setIsEditingResponse(false)
                      } finally {
                        setIsUpdating(false)
                      }
                    }}
                  >
                    {isUpdating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Publish Response
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIsEditingResponse(false)
                      setResponseText('')
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="border-border/50"
                onClick={() => {
                  setResponseText('')
                  setIsEditingResponse(true)
                }}
              >
                <Building2 className="h-4 w-4 mr-2" />
                Add Official Response
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Comments Section */}
      <div className="p-6">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5" />
          {countAllComments(post.comments)}{' '}
          {countAllComments(post.comments) === 1 ? 'Comment' : 'Comments'}
        </h3>

        {/* Add comment form */}
        <div className="mb-6">
          <CommentForm
            postId={post.id}
            user={currentUser}
            submitComment={submitComment}
            isSubmitting={isCommentPending}
          />
        </div>

        {/* Comments list - sorted newest first */}
        {post.comments.length > 0 ? (
          <div className="space-y-0">
            {[...post.comments]
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map((comment) => (
                <CommentItem
                  key={comment.id}
                  postId={post.id}
                  comment={comment}
                  avatarUrls={avatarUrls}
                  currentUser={currentUser}
                  submitComment={submitComment}
                  isCommentPending={isCommentPending}
                  onReaction={onReaction}
                  isReactionPending={isReactionPending}
                />
              ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No comments yet. Be the first to share your thoughts!
          </p>
        )}
      </div>
    </div>
  )
}
