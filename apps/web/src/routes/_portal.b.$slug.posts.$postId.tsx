import { Suspense } from 'react'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { portalDetailQueries } from '@/lib/queries/portal-detail'
import { portalQueries } from '@/lib/queries/portal'
import { UnsubscribeBanner } from '@/components/public/unsubscribe-banner'
import {
  VoteSidebar,
  VoteSidebarSkeleton,
} from '@/app/(portal)/b/[slug]/posts/[postId]/_components/vote-sidebar'
import { PostContentSection } from '@/app/(portal)/b/[slug]/posts/[postId]/_components/post-content-section'
import { OfficialResponseSection } from '@/app/(portal)/b/[slug]/posts/[postId]/_components/official-response-section'
import {
  CommentsSection,
  CommentsSectionSkeleton,
} from '@/app/(portal)/b/[slug]/posts/[postId]/_components/comments-section'
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
  const currentStatus = statusesQuery.data.find((s) => s.id === post.statusId)

  // Type the serialized fields for rendering
  const serializedPost = {
    ...post,
    contentJson: (post.contentJson ?? {}) as TiptapContent,
  }

  return (
    <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6">
      {/* Unsubscribe confirmation banner */}
      <UnsubscribeBanner postId={post.id} />

      {/* Back link */}
      <Link
        to="/"
        search={{ board: slug }}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>{board.name}</span>
      </Link>

      {/* Main content card */}
      <div className="bg-card border border-border/50 rounded-lg shadow-sm overflow-hidden">
        {/* Post header */}
        <div className="flex">
          {/* Vote & Subscribe section - left column */}
          <Suspense fallback={<VoteSidebarSkeleton />}>
            <VoteSidebar postId={postId} initialVoteCount={post.voteCount} />
          </Suspense>

          {/* Content section */}
          <PostContentSection post={serializedPost} currentStatus={currentStatus} />
        </div>

        {/* Official Response (if exists) */}
        {post.officialResponse && (
          <OfficialResponseSection
            content={post.officialResponse.content}
            authorName={post.officialResponse.authorName}
            respondedAt={post.officialResponse.respondedAt}
            workspaceName={settings.name}
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
