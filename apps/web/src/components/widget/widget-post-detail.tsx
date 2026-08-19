import { useCallback, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChatBubbleLeftIcon, Squares2X2Icon } from '@heroicons/react/24/solid'
import { useIntl, FormattedMessage } from 'react-intl'
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
import { useLoadMoreWidgetComments } from '@/lib/client/mutations/load-more-comments'

/** First-page root-comment count for the constrained widget viewport. */
const WIDGET_COMMENT_PAGE_SIZE = 15
import { useWidgetAuth } from './widget-auth-provider'
import { sendToHost } from '@/lib/client/widget-bridge'
import { WidgetCommentForm } from './widget-comment-form'
import { WidgetPortalTitle } from './widget-portal-title'
import type { TiptapContent } from '@/lib/shared/db-types'
import type { PostId } from '@quackback/ids'

interface StatusInfo {
  id: string
  name: string
  color: string
}

interface WidgetPostDetailProps {
  postId: string
  statuses: StatusInfo[]
}

export function WidgetPostDetail({ postId, statuses }: WidgetPostDetailProps) {
  const intl = useIntl()
  const { isIdentified, hmacRequired, user, ensureSessionThen, emitEvent, sessionVersion } =
    useWidgetAuth()
  const queryClient = useQueryClient()

  // Widget-specific post detail query that injects Bearer headers so the server
  // can resolve principalId for reaction hasReacted highlights.
  // Re-keyed on sessionVersion so it refetches after identify.
  const detailKey = widgetQueryKeys.postDetail.byId(postId, sessionVersion)
  const {
    data: post,
    isLoading,
    error,
  } = useQuery({
    queryKey: detailKey,
    queryFn: async (): Promise<PublicPostDetailView> => {
      const result = await fetchPublicPostDetail({
        // Smaller first page for the constrained widget viewport; further roots
        // load via "show more".
        data: { postId, commentsLimit: WIDGET_COMMENT_PAGE_SIZE },
        headers: getWidgetAuthHeaders(),
      })
      if (!result) throw new Error('Post not found')
      return result as PublicPostDetailView
    },
    staleTime: 30 * 1000,
  })

  // "Show more comments" appends the next page into the same widget detail cache.
  const {
    loadMore: loadMoreComments,
    isLoading: isLoadingMoreComments,
    hasMore: hasMoreComments,
  } = useLoadMoreWidgetComments(postId as PostId, detailKey, WIDGET_COMMENT_PAGE_SIZE)

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
    sendToHost({ type: 'quackback:navigate', url })
  }, [post, isIdentified])

  /** Submit a comment (root or reply). */
  const submitComment = useCallback(
    async (content: string, contentJson: TiptapContent | null, parentId?: string) => {
      await ensureSessionThen(async () => {
        const result = await createCommentFn({
          data: { postId, content, contentJson: contentJson ?? undefined, parentId },
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
    async (content: string, contentJson: TiptapContent | null, parentId: string) => {
      await submitComment(content, contentJson, parentId)
    },
    [submitComment]
  )

  // Per-board vote/comment capability, computed server-side for the real actor
  // (fetchPublicPostDetail runs with the widget's Bearer identity and the query
  // re-keys on sessionVersion, so this refetches after identify). Replaces the
  // old workspace-wide anonymous flags, which advertised CTAs on boards whose
  // per-action tier requires sign-in (#191). Undefined (legacy/cached) → false.
  const canVote = post?.canVote ?? false
  const canComment = post?.canComment ?? false
  // Identified viewer denied by the board tier (segments/team) = authorization,
  // not auth. Vote shows a dimmed tooltip; the comment form is replaced with the
  // reason. An anonymous viewer keeps the sign-in / email-identify path.
  const voteNoAccessReason =
    isIdentified && !canVote
      ? intl.formatMessage({
          id: 'widget.vote.noAccess',
          defaultMessage: "You don't have access to vote on this board",
        })
      : undefined
  const commentNoAccess = isIdentified && !canComment

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
        <p className="text-sm text-muted-foreground">
          <FormattedMessage
            id="widget.postDetail.error.couldNotLoad"
            defaultMessage="Could not load post"
          />
        </p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          {error instanceof Error
            ? error.message
            : intl.formatMessage({
                id: 'widget.postDetail.error.somethingWrong',
                defaultMessage: 'Something went wrong',
              })}
        </p>
      </div>
    )
  }

  return (
    <ScrollArea ref={scrollAreaRef} scrollBarClassName="w-1.5" className="flex-1 h-full">
      {/* Readable column when the host panel expands for long-form content. */}
      <div className="mx-auto w-full max-w-2xl px-3 pt-3 pb-4 space-y-3">
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
              noAccessReason={voteNoAccessReason}
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
              <span>
                {post.authorName ||
                  intl.formatMessage({
                    id: 'widget.postDetail.authorFallback',
                    defaultMessage: 'Anonymous',
                  })}
              </span>
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
            <p className="text-[11px] font-medium text-primary mb-1">
              <FormattedMessage
                id="widget.postDetail.officialResponse"
                defaultMessage="Official response"
              />
            </p>
            <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">
              {post.pinnedComment.content}
            </p>
            <p className="text-[11px] text-muted-foreground/60 mt-1">
              &mdash;{' '}
              {post.pinnedComment.authorName ||
                intl.formatMessage({
                  id: 'widget.postDetail.teamAuthorFallback',
                  defaultMessage: 'Team',
                })}
            </p>
          </div>
        )}

        {/* Comments section */}
        <div className="border-t border-border/50 pt-3">
          <div className="flex items-center gap-1.5 mb-3">
            <ChatBubbleLeftIcon className="h-3.5 w-3.5 text-muted-foreground/50" />
            <span className="text-xs font-medium text-muted-foreground">
              <FormattedMessage
                id="widget.postDetail.comments"
                defaultMessage="{count, plural, one {# comment} other {# comments}}"
                values={{ count: liveCommentCount }}
              />
            </span>
          </div>

          {/* Identified viewer denied by the board's comment tier (segments/team)
              — authorization, not auth: state it, no form or login prompt. */}
          {!post.isCommentsLocked && commentNoAccess && (
            <p className="text-xs text-muted-foreground/70 mb-3">
              <FormattedMessage
                id="widget.postDetail.commentNoAccess"
                defaultMessage="You don't have access to comment on this board"
              />
            </p>
          )}

          {/* Root comment form — unified: textarea + email (when anonymous) + single Post.
              For an anonymous viewer the email field escalates them to a real user. */}
          {!post.isCommentsLocked && !commentNoAccess && !hmacRequired && (
            <WidgetCommentForm isIdentified={isIdentified} user={user} onSubmit={submitComment} />
          )}

          {!post.isCommentsLocked && !commentNoAccess && hmacRequired && !canComment && (
            <button
              type="button"
              onClick={handleViewOnPortal}
              className="text-xs text-primary hover:text-primary/80 transition-colors mb-3"
            >
              <FormattedMessage
                id="widget.postDetail.loginToComment"
                defaultMessage="Log in to join the conversation"
              />
            </button>
          )}

          {post.isCommentsLocked && (
            <p className="text-xs text-muted-foreground/50 mb-3">
              <FormattedMessage
                id="widget.postDetail.commentsLocked"
                defaultMessage="Comments are locked on this post"
              />
            </p>
          )}

          <WidgetCommentList
            comments={post.comments}
            pinnedCommentId={post.pinnedCommentId}
            canComment={canComment && !post.isCommentsLocked}
            onSubmitComment={handleSubmitReply}
          />

          {hasMoreComments && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                disabled={isLoadingMoreComments}
                onClick={() => void loadMoreComments()}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {isLoadingMoreComments ? (
                  <FormattedMessage
                    id="widget.commentList.loadingMore"
                    defaultMessage="Loading..."
                  />
                ) : (
                  <FormattedMessage
                    id="widget.commentList.showMore"
                    defaultMessage="Show more comments"
                  />
                )}
              </button>
            </div>
          )}
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
