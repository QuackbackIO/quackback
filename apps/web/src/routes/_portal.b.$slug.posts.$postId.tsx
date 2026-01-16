import { Suspense, useEffect } from 'react'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ArrowLeftIcon } from '@heroicons/react/24/solid'
import { portalDetailQueries, type PublicPostDetailView } from '@/lib/queries/portal-detail'
import { portalQueries } from '@/lib/queries/portal'
import { UnsubscribeBanner } from '@/components/public/unsubscribe-banner'
import { VoteSidebar, VoteSidebarSkeleton } from '@/components/public/post-detail/vote-sidebar'
import { PostContentSection } from '@/components/public/post-detail/post-content-section'
import {
  OfficialResponseSection,
  PinnedCommentSection,
} from '@/components/public/post-detail/official-response-section'
import {
  CommentsSection,
  CommentsSectionSkeleton,
} from '@/components/public/post-detail/comments-section'
import { isValidTypeId, type PostId } from '@quackback/ids'
import type { TiptapContent } from '@/lib/schemas/posts'

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
    // Avatar data is now included directly in post (authorAvatarUrl) and comments (avatarUrl)
    await Promise.all([
      queryClient.prefetchQuery(portalDetailQueries.voteSidebarData(postId)),
      queryClient.prefetchQuery(portalDetailQueries.commentsSectionData(postId)),
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

  // Scroll to comment anchor after content loads (handles async-loaded comments)
  useEffect(() => {
    const hash = window.location.hash
    if (hash && hash.startsWith('#comment-')) {
      // Small delay to ensure DOM is fully rendered after Suspense
      const timeoutId = setTimeout(() => {
        const element = document.querySelector(hash)
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' })
          // Add highlight effect
          element.classList.add('bg-primary/5')
          setTimeout(() => element.classList.remove('bg-primary/5'), 2000)
        }
      }, 100)
      return () => clearTimeout(timeoutId)
    }
  }, [post.comments])

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
          <PostContentSection
            post={typedPost}
            currentStatus={currentStatus}
            authorAvatarUrl={post.authorAvatarUrl}
          />
        </div>

        {/* Pinned Comment / Official Response (if exists) */}
        {post.pinnedComment ? (
          <PinnedCommentSection
            comment={post.pinnedComment}
            workspaceName={settings?.name ?? 'Team'}
          />
        ) : post.officialResponse ? (
          <OfficialResponseSection
            content={post.officialResponse.content}
            authorName={post.officialResponse.authorName}
            respondedAt={post.officialResponse.respondedAt}
            workspaceName={settings?.name ?? 'Team'}
          />
        ) : null}

        {/* Comments Section */}
        <div className="border-t border-border/30 bg-muted/20">
          <Suspense fallback={<CommentsSectionSkeleton />}>
            <CommentsSection
              postId={postId}
              comments={post.comments}
              pinnedCommentId={post.pinnedCommentId}
            />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
