import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentOrganization } from '@/lib/tenant'
import {
  getPublicBoardBySlug,
  getPublicPostDetail,
  hasUserVotedOnPost,
  type PublicComment,
} from '@quackback/db/queries/public'
import { getStatusesByOrganization, db, member, eq, and } from '@quackback/db'
import { getUserIdentifier, getMemberIdentifier } from '@/lib/user-identifier'
import { getSession } from '@/lib/auth/server'
import { getBulkMemberAvatarData } from '@/lib/avatar'
import { VoteButton } from '@/components/public/vote-button'
import { CommentsSection } from '@/components/public/comments-section'
import { OfficialResponse } from '@/components/public/official-response'
import { PostContent } from '@/components/public/post-content'
import { Badge } from '@/components/ui/badge'
import { TimeAgo } from '@/components/ui/time-ago'

/**
 * Recursively collect all member IDs from comments and their nested replies
 */
function collectCommentMemberIds(comments: PublicComment[]): string[] {
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

  // Get session for authenticated commenting
  const session = await getSession()

  // Get user identifier - use member ID for authenticated users, anonymous cookie for others
  let userIdentifier = await getUserIdentifier()
  if (session?.user) {
    const memberRecord = await db.query.member.findFirst({
      where: and(eq(member.userId, session.user.id), eq(member.organizationId, org.id)),
    })
    if (memberRecord) {
      userIdentifier = getMemberIdentifier(memberRecord.id)
    }
  }

  // Get post detail with user's reaction state
  const post = await getPublicPostDetail(postId, userIdentifier)
  if (!post || post.board.slug !== slug) {
    notFound()
  }

  // Get statuses for display
  const statuses = await getStatusesByOrganization(org.id)
  const currentStatus = statuses.find((s) => s.slug === post.status)

  // Check if user has voted
  const hasVoted = await hasUserVotedOnPost(postId, userIdentifier)

  // Fetch avatar URLs for all comment authors
  const commentMemberIds = collectCommentMemberIds(post.comments)
  const commentAvatarMap = await getBulkMemberAvatarData(commentMemberIds)

  return (
    <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6">
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
          {/* Vote section - left column */}
          <div className="flex flex-col items-center justify-start py-6 px-4 border-r border-border/30">
            <VoteButton
              postId={post.id}
              initialVoteCount={post.voteCount}
              initialHasVoted={hasVoted}
              disabled={!org.portalPublicVoting}
            />
          </div>

          {/* Content section */}
          <div className="flex-1 p-6">
            {/* Status badge */}
            <Badge
              variant="outline"
              className="text-[11px] font-medium mb-3"
              style={{
                backgroundColor: `${currentStatus?.color || '#6b7280'}15`,
                color: currentStatus?.color || '#6b7280',
                borderColor: `${currentStatus?.color || '#6b7280'}40`,
              }}
            >
              {currentStatus?.name || post.status}
            </Badge>

            {/* Title */}
            <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-2">{post.title}</h1>

            {/* Author & time */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <span className="font-medium text-foreground/90">
                {post.authorName || 'Anonymous'}
              </span>
              <span className="text-muted-foreground/60">·</span>
              <TimeAgo date={post.createdAt} />
            </div>

            {/* Tags */}
            {post.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {post.tags.map((tag) => (
                  <Badge
                    key={tag.id}
                    variant="outline"
                    className="text-[11px]"
                    style={{
                      backgroundColor: `${tag.color}15`,
                      color: tag.color,
                      borderColor: `${tag.color}40`,
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
              className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-foreground/90"
            />
          </div>
        </div>

        {/* Official response */}
        {post.officialResponse && (
          <div className="border-t border-border/30 p-6">
            <OfficialResponse
              content={post.officialResponse.content}
              authorName={post.officialResponse.authorName}
              respondedAt={post.officialResponse.respondedAt}
              organizationName={org.name}
            />
          </div>
        )}

        {/* Comments section */}
        <div className="border-t border-border/30 p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            {post.comments.length} {post.comments.length === 1 ? 'Comment' : 'Comments'}
          </h2>

          <CommentsSection
            postId={post.id}
            comments={post.comments}
            allowCommenting={org.portalPublicCommenting}
            avatarUrls={Object.fromEntries(commentAvatarMap)}
            user={
              session?.user ? { name: session.user.name, email: session.user.email } : undefined
            }
          />
        </div>
      </div>
    </div>
  )
}
