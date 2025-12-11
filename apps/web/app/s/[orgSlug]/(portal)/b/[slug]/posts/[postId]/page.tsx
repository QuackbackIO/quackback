import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getOrganizationBySlug } from '@/lib/tenant'
import { getPostService, getBoardService, getStatusService } from '@/lib/services'
import type { PublicComment } from '@quackback/domain'
import { db, member, eq, and } from '@quackback/db'
import { getMemberIdentifier } from '@/lib/user-identifier'
import { getSession } from '@/lib/auth/server'
import { getBulkMemberAvatarData } from '@/lib/avatar'
import { AuthVoteButton } from '@/components/public/auth-vote-button'
import { AuthSubscriptionBell } from '@/components/public/auth-subscription-bell'
import { AuthCommentsSection } from '@/components/public/auth-comments-section'
import { OfficialResponse } from '@/components/public/official-response'
import { PostContent } from '@/components/public/post-content'
import { UnsubscribeBanner } from '@/components/public/unsubscribe-banner'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status-badge'
import { TimeAgo } from '@/components/ui/time-ago'
import { SubscriptionService } from '@quackback/domain/subscriptions'

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

/**
 * Recursively count all comments including nested replies
 */
function countAllComments(comments: PublicComment[]): number {
  let count = 0
  for (const comment of comments) {
    count += 1
    if (comment.replies && comment.replies.length > 0) {
      count += countAllComments(comment.replies)
    }
  }
  return count
}

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

  // Get session for authenticated interactions
  const session = await getSession()

  // Get user identifier if authenticated member
  let userIdentifier = ''
  let isMember = false
  if (session?.user) {
    const memberRecord = await db.query.member.findFirst({
      where: and(eq(member.userId, session.user.id), eq(member.organizationId, org.id)),
    })
    if (memberRecord) {
      userIdentifier = getMemberIdentifier(memberRecord.id)
      isMember = true
    }
  }

  // Authenticated members can vote and comment
  const canVote = isMember
  const canComment = isMember

  // Get post detail with user's reaction state
  const postResult = await getPostService().getPublicPostDetail(postId, userIdentifier || undefined)
  const post = postResult.success ? postResult.value : null
  if (!post || post.board.slug !== slug) {
    notFound()
  }

  // Get statuses for display
  const statusesResult = await getStatusService().listPublicStatuses(org.id)
  const statuses = statusesResult.success ? statusesResult.value : []
  const currentStatus = statuses.find((s) => s.slug === post.status)

  // Check if user has voted
  let hasVoted = false
  if (userIdentifier) {
    const voteResult = await getPostService().hasUserVotedOnPost(postId, userIdentifier)
    hasVoted = voteResult.success ? voteResult.value : false
  }

  // Check subscription status
  let subscriptionStatus: { subscribed: boolean; muted: boolean; reason: string | null } = {
    subscribed: false,
    muted: false,
    reason: null,
  }
  if (isMember) {
    const memberRecord = await db.query.member.findFirst({
      where: and(eq(member.userId, session!.user.id), eq(member.organizationId, org.id)),
    })
    if (memberRecord) {
      const subscriptionService = new SubscriptionService()
      subscriptionStatus = await subscriptionService.getSubscriptionStatus(
        memberRecord.id,
        postId,
        org.id
      )
    }
  }

  // Fetch avatar URLs for all comment authors
  const commentMemberIds = collectCommentMemberIds(post.comments)
  const commentAvatarMap = await getBulkMemberAvatarData(commentMemberIds)

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
          <div className="flex flex-col items-center justify-start py-6 px-4 border-r border-border/30 gap-4">
            <AuthVoteButton
              postId={post.id}
              initialVoteCount={post.voteCount}
              initialHasVoted={hasVoted}
              disabled={!canVote}
            />
            <AuthSubscriptionBell
              postId={post.id}
              initialStatus={subscriptionStatus}
              disabled={!isMember}
            />
          </div>

          {/* Content section */}
          <div className="flex-1 p-6">
            {/* Status */}
            <StatusBadge
              name={currentStatus?.name || post.status}
              color={currentStatus?.color}
              className="mb-3"
            />

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
                  <Badge key={tag.id} variant="secondary" className="text-[11px] font-normal">
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
            {countAllComments(post.comments)}{' '}
            {countAllComments(post.comments) === 1 ? 'Comment' : 'Comments'}
          </h2>

          <AuthCommentsSection
            postId={post.id}
            comments={post.comments}
            allowCommenting={canComment}
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
