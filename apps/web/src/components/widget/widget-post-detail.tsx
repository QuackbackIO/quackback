'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChatBubbleLeftIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid'
import { StatusBadge } from '@/components/ui/status-badge'
import { TimeAgo } from '@/components/ui/time-ago'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PostContent } from '@/components/public/post-content'
import { fetchPublicPostDetail } from '@/lib/server/functions/portal'
import { createCommentFn } from '@/lib/server/functions/comments'
import { getWidgetAuthHeaders, generateOneTimeToken } from '@/lib/client/widget-auth'
import { widgetQueryKeys } from '@/lib/client/hooks/use-widget-vote'
import type { PublicPostDetailView } from '@/lib/client/queries/portal-detail'
import { WidgetVoteButton } from './widget-vote-button'
import { WidgetCommentList } from './widget-comment-list'
import { useWidgetAuth } from './widget-auth-provider'
import type { PostId } from '@quackback/ids'

interface StatusInfo {
  id: string
  name: string
  color: string
}

interface WidgetPostDetailProps {
  postId: string
  statuses: StatusInfo[]
  anonymousVotingEnabled?: boolean
  anonymousCommentingEnabled?: boolean
}

export function WidgetPostDetail({
  postId,
  statuses,
  anonymousVotingEnabled = true,
  anonymousCommentingEnabled = false,
}: WidgetPostDetailProps) {
  const { isIdentified, user, ensureSession, emitEvent, sessionVersion } = useWidgetAuth()
  const queryClient = useQueryClient()

  // Comment state (root-level comment form only; replies are inline in the comment list)
  const [commentText, setCommentText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)

  // Widget-specific post detail query that injects Bearer headers so the server
  // can resolve principalId for reaction hasReacted highlights.
  // Re-keyed on sessionVersion so it refetches after identify.
  const {
    data: post,
    isLoading,
    error,
  } = useQuery({
    queryKey: widgetQueryKeys.postDetail.byId(postId, sessionVersion),
    queryFn: async (): Promise<PublicPostDetailView> => {
      const result = await fetchPublicPostDetail({
        data: { postId },
        headers: getWidgetAuthHeaders(),
      })
      if (!result) throw new Error('Post not found')
      return result as PublicPostDetailView
    },
    staleTime: 30 * 1000,
  })

  const status = post?.statusId ? (statuses.find((s) => s.id === post.statusId) ?? null) : null

  const handleViewOnPortal = useCallback(async () => {
    if (!post) return
    let url = `${window.location.origin}/b/${post.board.slug}/posts/${post.id}`
    // Generate a one-time token to transfer the session to the portal
    const ott = await generateOneTimeToken()
    if (ott) url += `?ott=${encodeURIComponent(ott)}`
    window.parent.postMessage({ type: 'quackback:navigate', url }, '*')
  }, [post])

  /** Submit a comment (root or reply). Used by both the top form and inline reply forms. */
  const submitComment = useCallback(
    async (content: string, parentId?: string) => {
      // Ensure session exists for anonymous commenters
      if (!isIdentified) {
        const ok = await ensureSession()
        if (!ok) return
      }

      const result = await createCommentFn({
        data: {
          postId,
          content,
          parentId,
        },
        headers: getWidgetAuthHeaders(),
      })
      emitEvent('comment:created', {
        postId,
        commentId: result.comment.id,
        parentId: parentId ?? null,
      })
      queryClient.invalidateQueries({ queryKey: widgetQueryKeys.postDetail.all })
    },
    [isIdentified, ensureSession, emitEvent, postId, queryClient]
  )

  const handleSubmitRootComment = useCallback(async () => {
    const content = commentText.trim()
    if (!content || isSubmitting) return

    setIsSubmitting(true)
    setCommentError(null)

    try {
      await submitComment(content)
      setCommentText('')
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : 'Failed to post comment')
    } finally {
      setIsSubmitting(false)
    }
  }, [commentText, isSubmitting, submitComment])

  /** Called by inline reply forms in the comment list */
  const handleSubmitReply = useCallback(
    async (content: string, parentId: string) => {
      await submitComment(content, parentId)
    },
    [submitComment]
  )

  // Identified users can always vote/comment; anonymous users only if the setting is enabled
  const canVote = isIdentified || anonymousVotingEnabled
  const canComment = isIdentified || anonymousCommentingEnabled

  // Scroll to top when navigating to a new post.
  // We track the last scrolled postId so we scroll exactly once per navigation,
  // even if the ScrollArea isn't mounted yet during the loading state.
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const scrolledForRef = useRef<string | null>(null)
  useEffect(() => {
    if (scrolledForRef.current === postId) return
    const viewport = scrollAreaRef.current?.querySelector('[data-slot="scroll-area-viewport"]')
    if (viewport) {
      viewport.scrollTop = 0
      scrolledForRef.current = postId
    }
  })

  const liveCommentCount = post?.comments ? countLiveComments(post.comments) : 0

  if (isLoading) {
    return (
      <div className="flex flex-col h-full px-3 pt-3">
        <div className="space-y-3 animate-pulse">
          <div className="h-5 bg-muted/50 rounded w-3/4" />
          <div className="h-3 bg-muted/30 rounded w-1/3" />
          <div className="h-20 bg-muted/30 rounded mt-2" />
          <div className="h-3 bg-muted/30 rounded w-1/2 mt-4" />
          <div className="space-y-2 mt-2">
            <div className="h-12 bg-muted/20 rounded" />
            <div className="h-12 bg-muted/20 rounded" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !post) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center">
        <p className="text-sm text-muted-foreground">Could not load post</p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          {error instanceof Error ? error.message : 'Something went wrong'}
        </p>
      </div>
    )
  }

  return (
    <ScrollArea ref={scrollAreaRef} className="flex-1 h-full">
      <div className="px-3 pt-3 pb-4 space-y-3">
        {/* Header: status, title, meta */}
        <div>
          {status && (
            <StatusBadge name={status.name} color={status.color} className="text-[10px] mb-1.5" />
          )}
          <h2 className="text-sm font-semibold text-foreground leading-snug">{post.title}</h2>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 mt-1.5">
            <span>{post.authorName || 'Anonymous'}</span>
            <span className="text-muted-foreground/30">&middot;</span>
            <TimeAgo date={post.createdAt} />
            <span className="text-muted-foreground/30">&middot;</span>
            <span>{post.board.name}</span>
          </div>
        </div>

        {/* Vote button + portal link */}
        <div className="flex items-center gap-2">
          <WidgetVoteButton
            postId={postId as PostId}
            voteCount={post.voteCount}
            onBeforeVote={canVote ? ensureSession : undefined}
            onAuthRequired={!canVote ? handleViewOnPortal : undefined}
            compact
          />
          <button
            type="button"
            onClick={handleViewOnPortal}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors ml-auto"
          >
            View full discussion
            <ArrowTopRightOnSquareIcon className="h-3 w-3" />
          </button>
        </div>

        {/* Post body */}
        {post.content && (
          <PostContent
            content={post.content}
            contentJson={post.contentJson}
            className="text-xs text-foreground/80 leading-relaxed"
          />
        )}

        {/* Pinned comment / official response */}
        {post.pinnedComment && (
          <div className="rounded-md border border-primary/20 bg-primary/[0.03] p-2.5">
            <p className="text-[10px] font-medium text-primary mb-1">Official response</p>
            <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">
              {post.pinnedComment.content}
            </p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              — {post.pinnedComment.authorName || 'Team'}
            </p>
          </div>
        )}

        {/* Comments section */}
        <div className="border-t border-border/50 pt-3">
          <div className="flex items-center gap-1.5 mb-3">
            <ChatBubbleLeftIcon className="h-3.5 w-3.5 text-muted-foreground/50" />
            <span className="text-xs font-medium text-muted-foreground">
              {liveCommentCount} {liveCommentCount === 1 ? 'comment' : 'comments'}
            </span>
          </div>

          {/* Root comment form */}
          {canComment && !post.isCommentsLocked && (
            <div className="mb-3">
              <div className="flex gap-2">
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Write a comment..."
                  rows={2}
                  disabled={isSubmitting}
                  className="flex-1 min-h-[52px] max-h-[120px] resize-none rounded-md border border-border/50 bg-muted/20 px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50 disabled:opacity-50 transition-colors"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      handleSubmitRootComment()
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={handleSubmitRootComment}
                  disabled={isSubmitting || !commentText.trim()}
                  className="self-end px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {isSubmitting ? 'Posting...' : 'Post'}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground/50 mt-1">
                {user ? `Posting as ${user.name || user.email}` : 'Posting anonymously'}
              </p>
              {commentError && <p className="text-[10px] text-destructive mt-1">{commentError}</p>}
            </div>
          )}

          {!canComment && !post.isCommentsLocked && (
            <button
              type="button"
              onClick={handleViewOnPortal}
              className="text-[10px] text-primary hover:text-primary/80 transition-colors mb-3"
            >
              Log in to join the conversation
            </button>
          )}

          {post.isCommentsLocked && (
            <p className="text-[10px] text-muted-foreground/50 mb-3">
              Comments are locked on this post
            </p>
          )}

          <WidgetCommentList
            comments={post.comments}
            pinnedCommentId={post.pinnedCommentId}
            canComment={canComment && !post.isCommentsLocked}
            onSubmitComment={handleSubmitReply}
          />
        </div>
      </div>
    </ScrollArea>
  )
}

/** Count non-deleted comments recursively */
function countLiveComments(
  comments: { deletedAt?: Date | string | null; replies: typeof comments }[]
): number {
  let count = 0
  for (const c of comments) {
    if (!c.deletedAt) count++
    count += countLiveComments(c.replies)
  }
  return count
}
