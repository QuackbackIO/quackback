import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getSettings } from '@/lib/tenant'
import { getPublicPostDetail } from '@/lib/posts'
import { getPublicBoardBySlug } from '@/lib/boards'
import { listPublicStatuses } from '@/lib/statuses'
import { UnsubscribeBanner } from '@/components/public/unsubscribe-banner'
import { VoteSidebar, VoteSidebarSkeleton } from './_components/vote-sidebar'
import { PostContentSection } from './_components/post-content-section'
import { OfficialResponseSection } from './_components/official-response-section'
import { CommentsSection, CommentsSectionSkeleton } from './_components/comments-section'
import { isValidTypeId, type PostId } from '@quackback/ids'

// Ensure page is not cached since it depends on user's cookie
export const dynamic = 'force-dynamic'

interface PostDetailPageProps {
  params: Promise<{ slug: string; postId: string }>
}

export default async function PostDetailPage({ params }: PostDetailPageProps) {
  const { slug, postId: postIdParam } = await params

  const settings = await getSettings()
  if (!settings) {
    return null
  }

  // Validate TypeID format
  if (!isValidTypeId(postIdParam, 'post')) {
    notFound()
  }
  const postId = postIdParam as PostId

  // Verify the board exists and is public
  const boardResult = await getPublicBoardBySlug(slug)
  const board = boardResult.success ? boardResult.value : null
  if (!board) {
    notFound()
  }

  // Get post detail - services now accept TypeIDs and return TypeIDs
  const postResult = await getPublicPostDetail(postId)
  const post = postResult.success ? postResult.value : null
  if (!post || post.board.slug !== slug) {
    notFound()
  }

  // Get statuses for display - services return TypeIDs directly
  const statusesResult = await listPublicStatuses()
  const statuses = statusesResult.success ? statusesResult.value : []
  const currentStatus = statuses.find((s) => s.id === post.statusId)

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
            <VoteSidebar postId={postId} initialVoteCount={post.voteCount} />
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
            workspaceName={settings.name}
          />
        )}

        {/* Comments section */}
        <Suspense fallback={<CommentsSectionSkeleton />}>
          <CommentsSection postId={postId} comments={post.comments} />
        </Suspense>
      </div>
    </div>
  )
}
