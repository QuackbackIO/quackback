import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getOrganizationBySlug } from '@/lib/tenant'
import { getPostService, getBoardService, getStatusService } from '@/lib/services'
import { UnsubscribeBanner } from '@/components/public/unsubscribe-banner'
import { VoteSidebar, VoteSidebarSkeleton } from './_components/vote-sidebar'
import { PostContentSection } from './_components/post-content-section'
import { OfficialResponseSection } from './_components/official-response-section'
import { CommentsSection, CommentsSectionSkeleton } from './_components/comments-section'

// Ensure page is not cached since it depends on user's cookie
export const dynamic = 'force-dynamic'

interface PostDetailPageProps {
  params: Promise<{ orgSlug: string; slug: string; postId: string }>
}

export default async function PostDetailPage({ params }: PostDetailPageProps) {
  const { orgSlug, slug, postId } = await params

  const org = await getOrganizationBySlug(orgSlug)
  if (!org) {
    return null
  }

  // Verify the board exists and is public
  const boardResult = await getBoardService().getPublicBoardBySlug(org.id, slug)
  const board = boardResult.success ? boardResult.value : null
  if (!board) {
    notFound()
  }

  // Get post detail (needed for 404 check and to pass data to child components)
  const postResult = await getPostService().getPublicPostDetail(postId)
  const post = postResult.success ? postResult.value : null
  if (!post || post.board.slug !== slug) {
    notFound()
  }

  // Get statuses for display
  const statusesResult = await getStatusService().listPublicStatuses(org.id)
  const statuses = statusesResult.success ? statusesResult.value : []
  const currentStatus = statuses.find((s) => s.slug === post.status)

  return (
    <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6">
      {/* Unsubscribe confirmation banner */}
      <UnsubscribeBanner postId={post.id} />

      {/* Back link */}
      <Link
        href={`/?board=${slug}`}
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
            <VoteSidebar
              postId={post.id}
              organizationId={org.id}
              initialVoteCount={post.voteCount}
            />
          </Suspense>

          {/* Content section */}
          <PostContentSection post={post} currentStatus={currentStatus} />
        </div>

        {/* Official response */}
        {post.officialResponse && (
          <OfficialResponseSection
            content={post.officialResponse.content}
            authorName={post.officialResponse.authorName}
            respondedAt={post.officialResponse.respondedAt}
            organizationName={org.name}
          />
        )}

        {/* Comments section */}
        <Suspense fallback={<CommentsSectionSkeleton />}>
          <CommentsSection postId={post.id} organizationId={org.id} comments={post.comments} />
        </Suspense>
      </div>
    </div>
  )
}
