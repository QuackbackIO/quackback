'use client'

import { useState, useTransition } from 'react'
import { Reply, ChevronDown, ChevronRight, SmilePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { TimeAgo } from '@/components/ui/time-ago'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { CommentForm } from './comment-form'
import { cn } from '@/lib/utils'

const REACTION_EMOJIS = ['👍', '❤️', '🎉', '😄', '🤔', '👀'] as const

interface CommentReaction {
  emoji: string
  count: number
  hasReacted: boolean
}

interface Comment {
  id: string
  content: string
  authorName: string | null
  createdAt: Date
  parentId: string | null
  replies: Comment[]
  reactions: CommentReaction[]
}

interface CommentThreadProps {
  postId: string
  comments: Comment[]
  allowCommenting?: boolean
  onCommentAdded?: () => void
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

export function CommentThread({
  postId,
  comments,
  allowCommenting = true,
  onCommentAdded,
}: CommentThreadProps) {
  return (
    <div className="space-y-6">
      {/* Add comment form */}
      {allowCommenting && (
        <div className="border rounded-lg p-4 bg-muted/50">
          <h3 className="text-sm font-medium mb-3">Leave a comment</h3>
          <CommentForm postId={postId} onSuccess={onCommentAdded} />
        </div>
      )}

      {/* Comments list */}
      {comments.length === 0 ? (
        <p className="text-muted-foreground text-center py-4">
          No comments yet. Be the first to share your thoughts!
        </p>
      ) : (
        <div className="space-y-0">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              postId={postId}
              comment={comment}
              allowCommenting={allowCommenting}
              onCommentAdded={onCommentAdded}
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
  onCommentAdded?: () => void
  depth?: number
}

function CommentItem({
  postId,
  comment,
  allowCommenting,
  onCommentAdded,
  depth = 0,
}: CommentItemProps) {
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [reactions, setReactions] = useState<CommentReaction[]>(comment.reactions)
  const [isPending, startTransition] = useTransition()
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

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
      <div
        className={cn(
          'relative',
          depth > 0 && 'ml-4 pl-4'
        )}
      >

        {/* Comment content */}
        <div className="py-2">
          {/* Comment header with avatar */}
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="text-xs bg-muted">
                {getInitials(comment.authorName)}
              </AvatarFallback>
            </Avatar>
            <span className="font-medium text-sm">
              {comment.authorName || 'Anonymous'}
            </span>
            <span className="text-muted-foreground text-xs">·</span>
            <TimeAgo date={comment.createdAt} className="text-xs text-muted-foreground" />
          </div>

          {/* Comment content - always visible */}
          <p className="text-sm whitespace-pre-wrap mt-1.5 ml-8 text-foreground/90 leading-relaxed">
            {comment.content}
          </p>

          {/* Actions row: expand/collapse, reactions, reply - always visible */}
          <div className="flex items-center gap-1 mt-2 ml-2">
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
            {allowCommenting && canNest && (
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
                allowCommenting={allowCommenting}
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
