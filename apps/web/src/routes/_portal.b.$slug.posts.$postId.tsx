import { Suspense } from 'react'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { getPublicPostDetail } from '@/lib/posts'
import { getPublicBoardBySlug } from '@/lib/boards'
import { listPublicStatuses } from '@/lib/statuses'
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
import type { BoardSettings } from '@quackback/db/types'
import type { TiptapContent } from '@/lib/schemas/posts'

export const Route = createFileRoute('/_portal/b/$slug/posts/$postId')({
  loader: async ({ params, context }) => {
    const { slug, postId: postIdParam } = params

    // Settings already available from root context
    const { settings } = context
    if (!settings) {
      throw notFound()
    }

    // Validate TypeID format
    if (!isValidTypeId(postIdParam, 'post')) {
      throw notFound()
    }
    const postId = postIdParam as PostId

    // Verify the board exists and is public
    const boardResult = await getPublicBoardBySlug(slug)
    const board = boardResult.success ? boardResult.value : null
    if (!board) {
      throw notFound()
    }

    // Get post detail - services now accept TypeIDs and return TypeIDs
    const postResult = await getPublicPostDetail(postId)
    const post = postResult.success ? postResult.value : null
    if (!post || post.board.slug !== slug) {
      throw notFound()
    }

    // Get statuses for display - services return TypeIDs directly
    const statusesResult = await listPublicStatuses()
    const statuses = statusesResult.success ? statusesResult.value : []
    const currentStatus = statuses.find((s) => s.id === post.statusId)

    // Type the board settings and post contentJson fields for serialization
    const serializedBoard = {
      ...board,
      settings: (board.settings ?? {}) as BoardSettings,
    }

    const serializedPost = {
      ...post,
      contentJson: (post.contentJson ?? {}) as TiptapContent,
    }

    return {
      settings,
      board: serializedBoard,
      post: serializedPost,
      postId,
      statuses,
      currentStatus,
      slug,
    }
  },
  component: PostDetailPage,
})

function PostDetailPage() {
  const { settings, board, post, postId, currentStatus, slug } = Route.useLoaderData()

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
          <PostContentSection post={post} currentStatus={currentStatus} />
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
