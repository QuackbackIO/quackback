'use client'

import { useState, useTransition, useEffect } from 'react'
import {
  X,
  ThumbsUp,
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
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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

interface InboxPostDetailProps {
  post: PostDetails | null
  isLoading: boolean
  members: TeamMember[]
  allTags: Tag[]
  statuses: PostStatusEntity[]
  onClose: () => void
  onStatusChange: (status: PostStatus) => Promise<void>
  onOwnerChange: (ownerId: string | null) => Promise<void>
  onTagsChange: (tagIds: string[]) => Promise<void>
  onOfficialResponseChange: (response: string | null) => Promise<void>
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
  onCommentAdded?: () => void
  depth?: number
}

function CommentItem({ postId, comment, onCommentAdded, depth = 0 }: CommentItemProps) {
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
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="text-xs bg-muted">
                {getInitials(comment.authorName)}
              </AvatarFallback>
            </Avatar>
            <span className="font-medium text-sm">{comment.authorName || 'Anonymous'}</span>
            <span className="text-muted-foreground text-xs">·</span>
            <span className="text-xs text-muted-foreground">
              {formatDate(new Date(comment.createdAt))}
            </span>
          </div>

          {/* Comment content */}
          <p className="text-sm whitespace-pre-wrap mt-1.5 ml-8 text-foreground/90 leading-relaxed">
            {comment.content}
          </p>

          {/* Actions row: expand/collapse, reactions, reply */}
          <div className="flex items-center gap-1 mt-2 ml-2">
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
            <Card className="mt-3 ml-8 max-w-lg p-3">
              <CommentForm
                postId={postId}
                parentId={comment.id}
                onSuccess={() => {
                  setShowReplyForm(false)
                  onCommentAdded?.()
                }}
                onCancel={() => setShowReplyForm(false)}
              />
            </Card>
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
  onClose,
  onStatusChange,
  onOwnerChange,
  onTagsChange,
  onOfficialResponseChange,
}: InboxPostDetailProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [isEditingResponse, setIsEditingResponse] = useState(false)
  const [responseText, setResponseText] = useState('')

  if (isLoading) {
    return (
      <div>
        <div className="sticky top-0 bg-card border-b px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold">Post Details</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
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

  return (
    <div>
      {/* Header */}
      <div className="sticky top-0 bg-card border-b px-4 py-3 flex items-center justify-between z-10">
        <h2 className="font-semibold">Post Details</h2>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-6">
        {/* Status & Board */}
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={post.status} onValueChange={handleStatusChange} disabled={isUpdating}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((status) => (
                <SelectItem key={status.id} value={status.slug}>
                  <div className="flex items-center gap-2">
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
          <Badge variant="outline">{post.board.name}</Badge>
          {isUpdating && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {/* Title */}
        <h1 className="text-xl font-semibold">{post.title}</h1>

        {/* Author & Date */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Avatar className="h-6 w-6">
              <AvatarFallback className="text-xs">{getInitials(post.authorName)}</AvatarFallback>
            </Avatar>
            <span>{post.authorName || 'Anonymous'}</span>
          </div>
          <span>{formatDate(new Date(post.createdAt))}</span>
        </div>

        {/* Votes */}
        <div className="flex items-center gap-2 text-sm">
          <ThumbsUp className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{post.voteCount} votes</span>
        </div>

        {/* Content */}
        <div className="prose prose-sm max-w-none text-foreground">
          <p className="whitespace-pre-wrap">{post.content}</p>
        </div>

        {/* Tags */}
        <div>
          <h3 className="text-sm font-medium mb-2">Tags</h3>
          <div className="flex flex-wrap gap-2">
            {allTags.map((tag) => {
              const isSelected = post.tags.some((t) => t.id === tag.id)
              return (
                <Badge
                  key={tag.id}
                  variant={isSelected ? 'default' : 'outline'}
                  className="cursor-pointer"
                  style={
                    isSelected
                      ? { backgroundColor: tag.color, borderColor: tag.color }
                      : { borderColor: tag.color, color: tag.color }
                  }
                  onClick={() => handleTagToggle(tag.id)}
                >
                  {tag.name}
                </Badge>
              )
            })}
            {allTags.length === 0 && (
              <span className="text-sm text-muted-foreground">No tags available</span>
            )}
          </div>
        </div>

        {/* Owner Assignment */}
        <div>
          <h3 className="text-sm font-medium mb-2">Assigned To</h3>
          <Select
            value={post.ownerId || 'unassigned'}
            onValueChange={handleOwnerChange}
            disabled={isUpdating}
          >
            <SelectTrigger className="w-full">
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

        {/* Official Response */}
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Official Response
          </h3>

          {isEditingResponse ? (
            <div className="space-y-3">
              <Textarea
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
                placeholder="Write your official response to this feedback..."
                rows={4}
                className="resize-none"
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
                  {post.officialResponse ? 'Update Response' : 'Publish Response'}
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
          ) : post.officialResponse ? (
            <Card className="border-primary/30 bg-primary/5 p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <Badge variant="default" className="bg-primary text-primary-foreground">
                    Published
                  </Badge>
                  {post.officialResponse.authorName && (
                    <span className="text-xs text-muted-foreground">
                      by {post.officialResponse.authorName}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    · {formatDate(new Date(post.officialResponse.respondedAt))}
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
              <p className="text-sm whitespace-pre-wrap">{post.officialResponse.content}</p>
            </Card>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
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

        {/* View on portal link */}
        <Button variant="outline" size="sm" asChild>
          <a
            href={`/${post.board.slug}/posts/${post.id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            View on portal
          </a>
        </Button>

        {/* Comments Section */}
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Comments ({post.comments.length})
          </h3>
          {post.comments.length > 0 ? (
            <div className="space-y-0">
              {post.comments.map((comment) => (
                <CommentItem key={comment.id} postId={post.id} comment={comment} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No comments yet</p>
          )}
        </div>
      </div>
    </div>
  )
}
