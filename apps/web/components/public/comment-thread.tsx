'use client'

import { useState, useTransition, useEffect } from 'react'
import { Reply, ChevronDown, ChevronRight, SmilePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TimeAgo } from '@/components/ui/time-ago'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CommentForm } from './comment-form'
import { cn } from '@/lib/utils'
import { getInitials } from '@quackback/domain/utils'
import { REACTION_EMOJIS } from '@quackback/db/types'

interface CommentReaction {
  emoji: string
  count: number
  hasReacted: boolean
}

interface Comment {
  id: string
  content: string
  authorName: string | null
  memberId: string | null
  createdAt: Date
  parentId: string | null
  isTeamMember: boolean
  replies: Comment[]
  reactions: CommentReaction[]
}

interface CommentThreadProps {
  postId: string
  comments: Comment[]
  allowCommenting?: boolean
  /** Map of memberId to avatar URL (base64 or external URL) */
  avatarUrls?: Record<string, string | null>
  onCommentAdded?: () => void
  user?: { name: string | null; email: string }
  /** Called when unauthenticated user tries to comment */
  onAuthRequired?: () => void
}

export function CommentThread({
  postId,
  comments,
  allowCommenting = true,
  avatarUrls,
  onCommentAdded,
  user,
  onAuthRequired,
}: CommentThreadProps) {
  return (
    <div className="space-y-6">
      {/* Add comment form or sign in prompt */}
      {allowCommenting ? (
        <CommentForm postId={postId} onSuccess={onCommentAdded} user={user} />
      ) : (
        <div className="flex items-center justify-center py-4 px-4 bg-muted/30 rounded-lg border border-border/30">
          <p className="text-sm text-muted-foreground mr-3">Sign in to comment</p>
          <Button variant="outline" size="sm" onClick={onAuthRequired}>
            Sign in
          </Button>
        </div>
      )}

      {/* Comments list - sorted newest first */}
      {comments.length === 0 ? (
        <p className="text-muted-foreground text-center py-4">
          No comments yet. Be the first to share your thoughts!
        </p>
      ) : (
        <div className="space-y-0">
          {[...comments]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map((comment) => (
              <CommentItem
                key={comment.id}
                postId={postId}
                comment={comment}
                allowCommenting={allowCommenting}
                avatarUrls={avatarUrls}
                onCommentAdded={onCommentAdded}
                user={user}
              />
            ))}
        </div>
      )}
    </div>
  )
}

interface CommentItemProps {
  postId: string
  comment: Comment
  allowCommenting: boolean
  avatarUrls?: Record<string, string | null>
  onCommentAdded?: () => void
  depth?: number
  user?: { name: string | null; email: string }
}

function CommentItem({
  postId,
  comment,
  allowCommenting,
  avatarUrls,
  onCommentAdded,
  depth = 0,
  user,
}: CommentItemProps) {
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [reactions, setReactions] = useState<CommentReaction[]>(comment.reactions)
  const [isPending, startTransition] = useTransition()
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

  // Sync reactions from props when they change (e.g., on page refresh)
  useEffect(() => {
    setReactions(comment.reactions)
  }, [comment.reactions])

  // Limit nesting depth for readability
  const maxDepth = 5
  const canNest = depth < maxDepth
  const hasReplies = comment.replies.length > 0

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
      {/* Thread container with Reddit-style indentation */}
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
            <TimeAgo date={comment.createdAt} className="text-xs text-muted-foreground" />
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
                data-testid="reaction-badge"
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
                  data-testid="add-reaction-button"
                >
                  <SmilePlus className="h-3.5 w-3.5" />
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
                onSuccess={() => {
                  setShowReplyForm(false)
                  onCommentAdded?.()
                }}
                onCancel={() => setShowReplyForm(false)}
                user={user}
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
                allowCommenting={allowCommenting}
                avatarUrls={avatarUrls}
                onCommentAdded={onCommentAdded}
                depth={depth + 1}
                user={user}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
