import { useCallback, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChatBubbleLeftIcon, Squares2X2Icon } from '@heroicons/react/24/solid'
import { TimeAgo } from '@/components/ui/time-ago'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PostContent } from '@/components/public/post-content'
import { fetchPublicPostDetail } from '@/lib/server/functions/portal'
import { createCommentFn } from '@/lib/server/functions/comments'
import { getWidgetAuthHeaders, generateOneTimeToken } from '@/lib/client/widget-auth'
import { buildPortalUrl } from './build-portal-url'
import { widgetQueryKeys } from '@/lib/client/hooks/use-widget-vote'
import type { PublicPostDetailView } from '@/lib/client/queries/portal-detail'
import { WidgetVoteButton } from './widget-vote-button'
import { WidgetCommentList } from './widget-comment-list'
import { useWidgetAuth } from './widget-auth-provider'
import { WidgetCommentForm } from './widget-comment-form'
import { WidgetPortalTitle } from './widget-portal-title'
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
  const {
    isIdentified,
    hmacRequired,
    user,
    ensureSessionThen,
    identifyWithEmail,
    emitEvent,
    sessionVersion,
  } = useWidgetAuth()
  const queryClient = useQueryClient()

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
    const ott = isIdentified ? await generateOneTimeToken() : null
    const url = buildPortalUrl({
      origin: window.location.origin,
      boardSlug: post.board.slug,
      postId: post.id,
      isIdentified,
      ott,
    })
    window.parent.postMessage({ type: 'quackback:navigate', url }, '*')
  }, [post, isIdentified])

  /** Submit a comment (root or reply). */
  const submitComment = useCallback(
    async (content: string, parentId?: string) => {
      await ensureSessionThen(async () => {
        const result = await createCommentFn({
          data: { postId, content, parentId },
          headers: getWidgetAuthHeaders(),
        })
        emitEvent('comment:created', {
          postId,
          commentId: result.comment.id,
          parentId: parentId ?? null,
        })
        queryClient.invalidateQueries({ queryKey: widgetQueryKeys.postDetail.all })
      })
    },
    [ensureSessionThen, emitEvent, postId, queryClient]
  )

  const handleSubmitReply = useCallback(
    async (content: string, parentId: string) => {
      await submitComment(content, parentId)
    },
    [submitComment]
  )

  // Identified users can always vote/comment; anonymous users only if the setting is enabled
  const canVote = isIdentified || anonymousVotingEnabled
  const canComment = isIdentified || anonymousCommentingEnabled

  const scrollAreaRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-slot="scroll-area-viewport"]')
    if (viewport) viewport.scrollTop = 0
  }, [postId])

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
        {/* Header: mirrors widget listing layout (vote left, status/title right) */}
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            <WidgetVoteButton
              postId={postId as PostId}
              voteCount={post.voteCount}
              onBeforeVote={
                canVote
                  ? async () => {
                      let success = false
                      await ensureSessionThen(() => {
                        success = true
                      })
                      return success
                    }
                  : undefined
              }
              onAuthRequired={!canVote ? handleViewOnPortal : undefined}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {status && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span
                    className="size-2 rounded-full shrink-0"
                    style={{ backgroundColor: status.color }}
                  />
                  {status.name}
                </span>
              )}
            </div>
            <WidgetPortalTitle title={post.title} onClick={handleViewOnPortal} />
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 mt-1">
              <span>{post.authorName || 'Anonymous'}</span>
              <span className="text-muted-foreground/30">&middot;</span>
              <TimeAgo date={post.createdAt} />
              <span className="text-muted-foreground/30">&middot;</span>
              <span className="inline-flex items-center gap-0.5">
                <Squares2X2Icon className="h-3 w-3 text-muted-foreground/40" />
                {post.board.name}
              </span>
            </div>
          </div>
        </div>

        {/* Post body */}
        {post.content && (
          <PostContent
            content={post.content}
            contentJson={post.contentJson}
            className="text-[13px] text-foreground/80 leading-relaxed"
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

          {/* Root comment form — unified: textarea + email (when anonymous) + single Post */}
          {!post.isCommentsLocked && !hmacRequired && (
            <WidgetCommentForm
              isIdentified={isIdentified}
              user={user}
              onSubmit={submitComment}
              identifyWithEmail={identifyWithEmail}
            />
          )}

          {!post.isCommentsLocked && hmacRequired && !canComment && (
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
export function countLiveComments(
  comments: { deletedAt?: Date | string | null; replies: typeof comments }[]
): number {
  let count = 0
  for (const c of comments) {
    if (!c.deletedAt) count++
    count += countLiveComments(c.replies)
  }
  return count
}
