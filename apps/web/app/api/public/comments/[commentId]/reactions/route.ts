import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { REACTION_EMOJIS, db, commentReactions, eq, and } from '@quackback/db'
import { getMemberIdentifier } from '@/lib/user-identifier'
import { getSession } from '@/lib/auth/server'
import { getCommentService } from '@/lib/services'
import type { ServiceContext, CommentError } from '@quackback/domain'
import { isValidTypeId, type CommentId } from '@quackback/ids'

const reactionSchema = z.object({
  emoji: z.string().min(1),
})

interface RouteParams {
  params: Promise<{ commentId: string }>
}

/**
 * Map CommentError codes to HTTP status codes
 */
function getHttpStatusFromError(error: CommentError): number {
  switch (error.code) {
    case 'COMMENT_NOT_FOUND':
      return 404
    case 'POST_NOT_FOUND':
      return 404
    case 'UNAUTHORIZED':
      return 403
    case 'VALIDATION_ERROR':
      return 400
    case 'INVALID_PARENT':
      return 400
    default:
      return 500
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { commentId: commentIdParam } = await params

    // Validate TypeID format
    if (!isValidTypeId(commentIdParam, 'comment')) {
      return NextResponse.json({ error: 'Invalid comment ID format' }, { status: 400 })
    }
    const commentId = commentIdParam as CommentId

    // Require authentication
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required. Please sign in to react.' },
        { status: 401 }
      )
    }

    // Parse and validate request body
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const result = reactionSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0]?.message || 'Invalid input' },
        { status: 400 }
      )
    }

    const { emoji } = result.data

    // Validate emoji is in allowed list
    if (!REACTION_EMOJIS.includes(emoji as (typeof REACTION_EMOJIS)[number])) {
      return NextResponse.json({ error: 'Invalid emoji' }, { status: 400 })
    }

    // Get the comment to find its organization
    const comment = await db.query.comments.findFirst({
      where: (comments, { eq }) => eq(comments.id, commentId),
    })

    if (!comment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

    // Get the post to find the board and organization
    const post = await db.query.posts.findFirst({
      where: (posts, { eq }) => eq(posts.id, comment.postId),
    })

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    const board = await db.query.boards.findFirst({
      where: (boards, { eq }) => eq(boards.id, post.boardId),
    })

    if (!board) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    // Check if user is a member of this organization
    const memberRecord = await db.query.member.findFirst({
      where: (member, { eq, and }) =>
        and(eq(member.userId, session.user.id), eq(member.organizationId, board.organizationId)),
    })

    if (!memberRecord) {
      return NextResponse.json(
        { error: 'You must be a member of this workspace to react.' },
        { status: 403 }
      )
    }

    // Use member identifier for authenticated users
    const userIdentifier = getMemberIdentifier(memberRecord.id)

    // Build service context
    const ctx: ServiceContext = {
      organizationId: board.organizationId,
      userId: session.user.id,
      memberId: memberRecord.id,
      memberRole: memberRecord.role as 'owner' | 'admin' | 'member' | 'user',
      userName: session.user.name || session.user.email,
      userEmail: session.user.email,
    }

    // Check if reaction already exists to determine if we should add or remove
    const existingReaction = await db.query.commentReactions.findFirst({
      where: and(
        eq(commentReactions.commentId, commentId),
        eq(commentReactions.userIdentifier, userIdentifier),
        eq(commentReactions.emoji, emoji)
      ),
    })

    // Call CommentService to toggle the reaction
    const commentService = getCommentService()
    const serviceResult = existingReaction
      ? await commentService.removeReaction(commentId, emoji, ctx)
      : await commentService.addReaction(commentId, emoji, ctx)

    if (!serviceResult.success) {
      const status = getHttpStatusFromError(serviceResult.error)
      return NextResponse.json({ error: serviceResult.error.message }, { status })
    }

    return NextResponse.json(serviceResult.value)
  } catch (error) {
    console.error('Error toggling comment reaction:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
