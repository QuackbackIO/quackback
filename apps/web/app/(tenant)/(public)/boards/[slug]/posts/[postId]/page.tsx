import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentOrganization } from '@/lib/tenant'
import { getPublicBoardBySlug, getPublicPostDetail, hasUserVotedOnPost } from '@quackback/db/queries/public'
import { getBoardSettings } from '@quackback/db/types'
import { getUserIdentifier } from '@/lib/user-identifier'
import { VoteButton } from '@/components/public/vote-button'
import { CommentsSection } from '@/components/public/comments-section'
import { Badge } from '@/components/ui/badge'
import { TimeAgo } from '@/components/ui/time-ago'
import type { PostStatus } from '@quackback/db'

const STATUS_COLORS: Record<PostStatus, string> = {
  open: 'bg-blue-500',
  under_review: 'bg-yellow-500',
  planned: 'bg-purple-500',
  in_progress: 'bg-orange-500',
  complete: 'bg-green-500',
  closed: 'bg-gray-500',
}

const STATUS_LABELS: Record<PostStatus, string> = {
  open: 'Open',
  under_review: 'Under Review',
  planned: 'Planned',
  in_progress: 'In Progress',
  complete: 'Complete',
  closed: 'Closed',
}

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

  // Get post detail
  const post = await getPublicPostDetail(postId)
  if (!post || post.board.slug !== slug) {
    notFound()
  }

  // Get board settings
  const boardSettings = getBoardSettings(board)

  // Check if user has voted
  const userIdentifier = await getUserIdentifier()
  const hasVoted = await hasUserVotedOnPost(postId, userIdentifier)

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back link */}
      <Link
        href={`/boards/${slug}`}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {board.name}
      </Link>

      {/* Post header */}
      <div className="flex gap-4 mb-6">
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
              className={`shrink-0 text-white ${STATUS_COLORS[post.status]}`}
            >
              {STATUS_LABELS[post.status]}
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
        <div className="flex flex-wrap gap-2 mb-6">
          {post.tags.map((tag) => (
            <Badge
              key={tag.id}
              variant="secondary"
              style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
            >
              {tag.name}
            </Badge>
          ))}
        </div>
      )}

      {/* Post content */}
      <div className="prose prose-neutral dark:prose-invert max-w-none mb-8">
        <p className="whitespace-pre-wrap">{post.content}</p>
      </div>

      {/* Comments section */}
      <div className="border-t pt-6">
        <h2 className="text-lg font-semibold mb-4">
          Comments ({post.comments.length})
        </h2>

        <CommentsSection
          postId={post.id}
          comments={post.comments}
          allowCommenting={boardSettings.publicCommenting}
        />
      </div>
    </div>
  )
}
