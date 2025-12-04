import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentOrganization } from '@/lib/tenant'
import {
  getPublicBoardBySlug,
  getPublicPostDetail,
  hasUserVotedOnPost,
} from '@quackback/db/queries/public'
import { getStatusesByOrganization } from '@quackback/db'
import { getBoardSettings } from '@quackback/db/types'
import { getUserIdentifier } from '@/lib/user-identifier'
import { getSession } from '@/lib/auth/server'
import { VoteButton } from '@/components/public/vote-button'
import { CommentsSection } from '@/components/public/comments-section'
import { OfficialResponse } from '@/components/public/official-response'
import { PostContent } from '@/components/public/post-content'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { TimeAgo } from '@/components/ui/time-ago'

// Ensure page is not cached since it depends on user's cookie
export const dynamic = 'force-dynamic'

interface PostDetailPageProps {
  params: Promise<{ slug: string; postId: string }>
}

export default async function PostDetailPage({ params }: PostDetailPageProps) {
  const org = await getCurrentOrganization()
  if (!org) {
    return null
  }

  const { slug, postId } = await params

  // Verify the board exists and is public
  const board = await getPublicBoardBySlug(org.id, slug)
  if (!board) {
    notFound()
  }

  // Get user identifier for tracking votes and reactions
  const userIdentifier = await getUserIdentifier()

  // Get post detail with user's reaction state
  const post = await getPublicPostDetail(postId, userIdentifier)
  if (!post || post.board.slug !== slug) {
    notFound()
  }

  // Get board settings
  const boardSettings = getBoardSettings(board)

  // Get statuses for display
  const statuses = await getStatusesByOrganization(org.id)
  const currentStatus = statuses.find((s) => s.slug === post.status)

  // Check if user has voted
  const hasVoted = await hasUserVotedOnPost(postId, userIdentifier)

  // Get session for authenticated commenting
  const session = await getSession()

  return (
    <div className="max-w-4xl mx-auto py-8">
      {/* Back link */}
      <Link
        href={`/?board=${slug}`}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {board.name}
      </Link>

      <Card className="p-6">
        {/* Post header */}
        <div className="flex gap-4 mb-4">
          <VoteButton
            postId={post.id}
            initialVoteCount={post.voteCount}
            initialHasVoted={hasVoted}
            disabled={!boardSettings.publicVoting}
          />

          <div className="flex-1">
            <div className="flex items-start gap-2 mb-2">
              <h1 className="text-2xl font-bold flex-1">{post.title}</h1>
              <Badge
                variant="outline"
                className="shrink-0"
                style={{
                  backgroundColor: `${currentStatus?.color || '#6b7280'}20`,
                  color: currentStatus?.color || '#6b7280',
                  borderColor: `${currentStatus?.color || '#6b7280'}50`,
                }}
              >
                {currentStatus?.name || post.status}
              </Badge>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{post.authorName || 'Anonymous'}</span>
              <span>·</span>
              <TimeAgo date={post.createdAt} />
            </div>
          </div>
        </div>

        {/* Tags */}
        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {post.tags.map((tag) => (
              <Badge
                key={tag.id}
                variant="secondary"
                style={{
                  backgroundColor: `${tag.color}20`,
                  color: tag.color,
                  borderColor: `${tag.color}50`,
                }}
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        )}

        {/* Post content */}
        <PostContent
          content={post.content}
          contentJson={post.contentJson}
          className="prose prose-neutral dark:prose-invert max-w-none"
        />

        {/* Official response */}
        {post.officialResponse && (
          <div className="mt-6">
            <OfficialResponse
              content={post.officialResponse.content}
              authorName={post.officialResponse.authorName}
              respondedAt={post.officialResponse.respondedAt}
              organizationName={org.name}
            />
          </div>
        )}

        {/* Comments section */}
        <div className="mt-6 pt-6 border-t">
          <h2 className="text-sm font-medium text-muted-foreground mb-4">
            {post.comments.length} {post.comments.length === 1 ? 'comment' : 'comments'}
          </h2>

          <CommentsSection
            postId={post.id}
            comments={post.comments}
            allowCommenting={boardSettings.publicCommenting}
            user={
              session?.user ? { name: session.user.name, email: session.user.email } : undefined
            }
          />
        </div>
      </Card>
    </div>
  )
}
