'use client'

import { useState, useTransition, useEffect } from 'react'
import {
  X,
  ChevronUp,
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
  Settings2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { InboxEmptyState } from './inbox-empty-state'
import { CommentForm } from '@/components/public/comment-form'
import { PostContent } from '@/components/public/post-content'
import { TimeAgo } from '@/components/ui/time-ago'
import type { PostStatus, Tag, Board, Comment, PostStatusEntity } from '@quackback/db'

const REACTION_EMOJIS = ['👍', '❤️', '🎉', '😄', '🤔', '👀'] as const

interface CommentReaction {
  emoji: string
  count: number
  hasReacted: boolean
}

interface TeamMember {
  id: string
  name: string
  email: string
  image?: string | null
}

interface OfficialResponse {
  content: string
  authorName: string | null
  respondedAt: Date
}

interface PostDetails {
  id: string
  title: string
  content: string
  contentJson?: unknown
  status: PostStatus
  voteCount: number
  // Member-scoped identity (Hub-and-Spoke model)
  memberId: string | null
  ownerMemberId: string | null
  // Legacy/anonymous identity fields
  authorName: string | null
  authorEmail: string | null
  ownerId: string | null
  createdAt: Date
  board: Pick<Board, 'id' | 'name' | 'slug'>
  tags: Pick<Tag, 'id' | 'name' | 'color'>[]
  comments: CommentWithReplies[]
  officialResponse: OfficialResponse | null
}

interface CommentWithReplies extends Comment {
  replies: CommentWithReplies[]
  reactions: CommentReaction[]
}

interface CurrentUser {
  name: string
  email: string
}

interface InboxPostDetailProps {
  post: PostDetails | null
  isLoading: boolean
  members: TeamMember[]
  allTags: Tag[]
  statuses: PostStatusEntity[]
  /** Map of memberId to avatar URL (base64 or external URL) */
  avatarUrls?: Record<string, string | null>
  currentUser: CurrentUser
  onClose: () => void
  onStatusChange: (status: PostStatus) => Promise<void>
  onOwnerChange: (ownerId: string | null) => Promise<void>
  onTagsChange: (tagIds: string[]) => Promise<void>
  onOfficialResponseChange: (response: string | null) => Promise<void>
  onCommentAdded?: () => void
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

function getInitials(name: string | null): string {
  if (!name) return '?'
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
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
  onCommentAdded?: () => void
  depth?: number
}

function CommentItem({
  postId,
  comment,
  avatarUrls,
  currentUser,
  onCommentAdded,
  depth = 0,
}: CommentItemProps) {
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

  // Reactions are pre-aggregated from the server with hasReacted already computed
  const [reactions, setReactions] = useState<CommentReaction[]>(comment.reactions || [])

  // Sync reactions from props when they change (e.g., on data refresh)
  useEffect(() => {
    setReactions(comment.reactions || [])
  }, [comment.reactions])

  const maxDepth = 5
  const canNest = depth < maxDepth
  const hasReplies = comment.replies && comment.replies.length > 0

  const handleReaction = async (emoji: string) => {
    setShowEmojiPicker(false)
    startTransition(async () => {
      try {
        const response = await fetch(`/api/public/comments/${comment.id}/reactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emoji }),
        })

        if (response.ok) {
          const data = await response.json()
          setReactions(data.reactions)
        }
      } catch (error) {
        console.error('Failed to toggle reaction:', error)
      }
    })
  }

  return (
    <div className="group/thread">
      <div className={cn('relative', depth > 0 && 'ml-4 pl-4')}>
        {/* Comment content */}
        <div className="py-2">
          {/* Comment header with avatar */}
          <div className="flex items-center gap-2">
            <Avatar
              className={cn(
                'h-8 w-8 shrink-0',
                comment.isTeamMember && 'ring-2 ring-primary ring-offset-2'
              )}
            >
              {comment.memberId && avatarUrls?.[comment.memberId] && (
                <AvatarImage
                  src={avatarUrls[comment.memberId]!}
                  alt={comment.authorName || 'Comment author'}
                />
              )}
              <AvatarFallback
                className={cn(
                  'text-xs',
                  comment.isTeamMember ? 'bg-primary text-primary-foreground' : 'bg-muted'
                )}
              >
                {comment.isTeamMember ? (
                  <Building2 className="h-4 w-4" />
                ) : (
                  getInitials(comment.authorName)
                )}
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
                disabled={isPending}
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
                  disabled={isPending}
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
                onSuccess={() => {
                  setShowReplyForm(false)
                  onCommentAdded?.()
                }}
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
                onCommentAdded={onCommentAdded}
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
  post,
  isLoading,
  members,
  allTags,
  statuses,
  avatarUrls,
  currentUser,
  onClose,
  onStatusChange,
  onOwnerChange,
  onTagsChange,
  onOfficialResponseChange,
  onCommentAdded,
}: InboxPostDetailProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [isEditingResponse, setIsEditingResponse] = useState(false)
  const [responseText, setResponseText] = useState('')

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
      await onStatusChange(value as PostStatus)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleOwnerChange = async (value: string) => {
    setIsUpdating(true)
    try {
      await onOwnerChange(value === 'unassigned' ? null : value)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleTagToggle = async (tagId: string) => {
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

  const currentStatus = statuses.find((s) => s.slug === post.status)

  return (
    <div>
      {/* Header */}
      <div className="sticky top-0 bg-background/95 backdrop-blur-sm border-b border-border/50 px-4 py-3 flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Post Details</h2>
          <Button variant="ghost" size="sm" asChild className="h-7 px-2 text-muted-foreground">
            <a
              href={`/${post.board.slug}/posts/${post.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Main content area - two column layout like public view */}
      <div className="flex border-b border-border/30">
        {/* Vote section - left column */}
        <div className="flex flex-col items-center justify-start py-6 px-4 border-r border-border/30">
          <div className="flex flex-col items-center">
            <ChevronUp className="h-6 w-6 text-muted-foreground" />
            <span className="text-lg font-bold text-foreground">{post.voteCount}</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">votes</span>
          </div>
        </div>

        {/* Content section */}
        <div className="flex-1 min-w-0 p-6">
          {/* Status badge */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={isUpdating}
                className="inline-flex items-center gap-1.5 mb-3 group"
              >
                <Badge
                  variant="outline"
                  className="text-[11px] font-medium cursor-pointer group-hover:opacity-80 transition-opacity"
                  style={{
                    backgroundColor: `${currentStatus?.color || '#6b7280'}15`,
                    color: currentStatus?.color || '#6b7280',
                    borderColor: `${currentStatus?.color || '#6b7280'}40`,
                  }}
                >
                  {currentStatus?.name || post.status}
                </Badge>
                <ChevronDown className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                {isUpdating && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-1" align="start">
              {statuses.map((status) => (
                <button
                  key={status.id}
                  type="button"
                  onClick={() => handleStatusChange(status.slug)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors',
                    post.status === status.slug ? 'bg-muted font-medium' : 'hover:bg-muted/50'
                  )}
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: status.color }}
                  />
                  {status.name}
                </button>
              ))}
            </PopoverContent>
          </Popover>

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

          {/* Tags */}
          {post.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {post.tags.map((tag) => (
                <Badge
                  key={tag.id}
                  variant="outline"
                  className="text-[11px]"
                  style={{
                    backgroundColor: `${tag.color}15`,
                    color: tag.color,
                    borderColor: `${tag.color}40`,
                  }}
                >
                  {tag.name}
                </Badge>
              ))}
            </div>
          )}

          {/* Post content */}
          <PostContent
            content={post.content}
            contentJson={post.contentJson}
            className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-foreground/90"
          />
        </div>
      </div>

      {/* Official response (if exists) */}
      {post.officialResponse && (
        <div className="border-b border-border/30 p-6">
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
            <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
              {post.officialResponse.content}
            </p>
          </div>
        </div>
      )}

      {/* Admin Actions Section */}
      <div className="border-b border-border/30 p-6 bg-muted/30">
        <div className="flex items-center gap-2 mb-4">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Manage Post
          </h3>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Tags */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">Tags</label>
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tag) => {
                const isSelected = post.tags.some((t) => t.id === tag.id)
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => handleTagToggle(tag.id)}
                    disabled={isUpdating}
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors disabled:opacity-50"
                    style={{
                      backgroundColor: isSelected ? tag.color : `${tag.color}15`,
                      color: isSelected ? '#fff' : tag.color,
                    }}
                  >
                    {tag.name}
                  </button>
                )
              })}
              {allTags.length === 0 && (
                <span className="text-xs text-muted-foreground">No tags available</span>
              )}
            </div>
          </div>

          {/* Owner Assignment */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">
              Assigned To
            </label>
            <Select
              value={post.ownerId || 'unassigned'}
              onValueChange={handleOwnerChange}
              disabled={isUpdating}
            >
              <SelectTrigger className="h-8 text-sm border-border/50">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name || member.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Official Response Editor */}
        {!post.officialResponse && (
          <div className="mt-4 pt-4 border-t border-border/30">
            {isEditingResponse ? (
              <div className="space-y-3">
                <Textarea
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  placeholder="Write your official response to this feedback..."
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
        )}

        {/* Edit existing response */}
        {post.officialResponse && isEditingResponse && (
          <div className="mt-4 pt-4 border-t border-border/30 space-y-3">
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
                Update Response
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
        )}
      </div>

      {/* Comments Section */}
      <div className="p-6">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5" />
          {post.comments.length} {post.comments.length === 1 ? 'Comment' : 'Comments'}
        </h3>
        {post.comments.length > 0 ? (
          <div className="space-y-0">
            {post.comments.map((comment) => (
              <CommentItem
                key={comment.id}
                postId={post.id}
                comment={comment}
                avatarUrls={avatarUrls}
                currentUser={currentUser}
                onCommentAdded={onCommentAdded}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No comments yet</p>
        )}
      </div>
    </div>
  )
}
