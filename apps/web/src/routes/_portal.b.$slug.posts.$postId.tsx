import { Suspense } from 'react'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ArrowLeftIcon } from '@heroicons/react/24/solid'
import {
  portalDetailQueries,
  type PublicPostDetailView,
  type PublicCommentView,
} from '@/lib/queries/portal-detail'
import { portalQueries } from '@/lib/queries/portal'
import { UnsubscribeBanner } from '@/components/public/unsubscribe-banner'
import { VoteSidebar, VoteSidebarSkeleton } from '@/components/public/post-detail/vote-sidebar'
import { PostContentSection } from '@/components/public/post-detail/post-content-section'
import { OfficialResponseSection } from '@/components/public/post-detail/official-response-section'
import {
  CommentsSection,
  CommentsSectionSkeleton,
} from '@/components/public/post-detail/comments-section'
import { isValidTypeId, type PostId, type MemberId } from '@quackback/ids'
import type { TiptapContent } from '@/lib/schemas/posts'

/**
 * Recursively collect all member IDs from comments and their nested replies
 * Used for prefetching avatar data in the loader
 */
function collectCommentMemberIds(comments: PublicCommentView[]): string[] {
  const memberIds: string[] = []
  for (const comment of comments) {
    if (comment.memberId) {
      memberIds.push(comment.memberId)
    }
    if (comment.replies.length > 0) {
      memberIds.push(...collectCommentMemberIds(comment.replies))
    }
  }
  return memberIds
}

export const Route = createFileRoute('/_portal/b/$slug/posts/$postId')({
  loader: async ({ params, context }) => {
    const { slug, postId: postIdParam } = params

    // Settings already available from root context
    const { settings, queryClient } = context
    if (!settings) {
      throw notFound()
    }

    // Validate TypeID format
    if (!isValidTypeId(postIdParam, 'post')) {
      throw notFound()
    }
    const postId = postIdParam as PostId

    // Pre-fetch all data using React Query
    const [board, post, _statuses] = await Promise.all([
      queryClient.ensureQueryData(portalDetailQueries.board(slug)),
      queryClient.ensureQueryData(portalDetailQueries.postDetail(postId)),
      queryClient.ensureQueryData(portalQueries.statuses()),
    ])

    // Verify board exists
    if (!board) {
      throw notFound()
    }

    // Verify post exists and belongs to this board
    if (!post || post.board.slug !== slug) {
      throw notFound()
    }

    // Prefetch user-specific data for SSR
    // Uses prefetchQuery which won't throw on error - components fall back to client fetch
    const commentMemberIds = collectCommentMemberIds(post.comments)

    // Await prefetch so data is SSR'd (included in dehydrated state)
    // prefetchQuery doesn't throw, so errors are handled gracefully
    await Promise.all([
      queryClient.prefetchQuery(portalDetailQueries.voteSidebarData(postId)),
      queryClient.prefetchQuery(
        portalDetailQueries.commentsSectionData(postId, commentMemberIds as MemberId[])
      ),
      // Prefetch votedPosts so hasVoted state is SSR'd for vote button highlighting
      queryClient.prefetchQuery(portalDetailQueries.votedPosts()),
    ])

    return {
      settings,
      postId,
      slug,
    }
  },
  component: PostDetailPage,
})

function PostDetailPage() {
  const { settings, postId, slug } = Route.useLoaderData()

  // Read pre-fetched data from React Query cache
  const boardQuery = useSuspenseQuery(portalDetailQueries.board(slug))
  const postQuery = useSuspenseQuery(portalDetailQueries.postDetail(postId))
  const statusesQuery = useSuspenseQuery(portalQueries.statuses())

  const board = boardQuery.data
  const post = postQuery.data

  // Null safety check - ensure post and board are available
  if (!post || !board) {
    return <div>Post not found</div>
  }

  const currentStatus = statusesQuery.data.find((s) => s.id === post.statusId)

  // Create properly typed post with TipTap content
  const typedPost: PublicPostDetailView = {
    ...post,
    contentJson: (post.contentJson ?? { type: 'doc' }) as TiptapContent,
  }

  return (
    <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6">
      {/* Unsubscribe confirmation banner */}
      <UnsubscribeBanner postId={post.id as PostId} />

      {/* Back link */}
      <Link
        to="/"
        search={{ board: slug }}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        <span>{board.name}</span>
      </Link>

      {/* Main content card */}
      <div className="bg-card border border-border/50 rounded-lg shadow-sm overflow-hidden">
        {/* Post header */}
        <div className="flex">
          {/* Vote & Subscribe section - left column */}
          <Suspense fallback={<VoteSidebarSkeleton />}>
            <VoteSidebar postId={postId} voteCount={post.voteCount} />
          </Suspense>

          {/* Content section */}
          <PostContentSection post={typedPost} currentStatus={currentStatus} />
        </div>

        {/* Official Response (if exists) */}
        {post.officialResponse && (
          <OfficialResponseSection
            content={post.officialResponse.content}
            authorName={post.officialResponse.authorName}
            respondedAt={post.officialResponse.respondedAt}
            workspaceName={settings?.name ?? 'Team'}
          />
        )}

        {/* Comments Section */}
        <div className="border-t border-border/30 bg-muted/20">
          <Suspense fallback={<CommentsSectionSkeleton />}>
            <CommentsSection postId={postId} comments={post.comments} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
