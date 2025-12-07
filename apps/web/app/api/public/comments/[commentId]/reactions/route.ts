import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { REACTION_EMOJIS, db, commentReactions, eq, and } from '@quackback/db'
import {
  getRawUserIdentifierFromRequest,
  setUserIdentifierCookie,
  hasUserIdentifierCookie,
  getMemberIdentifier,
} from '@/lib/user-identifier'
import { getSession } from '@/lib/auth/server'
import { getCommentService } from '@/lib/services'
import type { ServiceContext, CommentError } from '@quackback/domain'

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
    const { commentId } = await params

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

    // Check for authenticated user
    const session = await getSession()
    let userIdentifier: string
    let ctx: ServiceContext
    let responseHeaders: Headers | undefined

    if (session?.user) {
      // Note: For reactions on public comments, we need to find which organization this comment belongs to
      // We'll get this from the comment itself via the service
      // For now, we'll handle this similar to votes - get the comment first to find the org

      // First, get the comment to find its organization
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

      if (memberRecord) {
        // Use member identifier for authenticated users
        userIdentifier = getMemberIdentifier(memberRecord.id)

        // Build full service context for authenticated users
        ctx = {
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
        let serviceResult

        if (existingReaction) {
          // Remove reaction
          serviceResult = await commentService.removeReaction(commentId, emoji, ctx)
        } else {
          // Add reaction
          serviceResult = await commentService.addReaction(commentId, emoji, ctx)
        }

        // Map Result to HTTP response
        if (!serviceResult.success) {
          const status = getHttpStatusFromError(serviceResult.error)
          return NextResponse.json({ error: serviceResult.error.message }, { status })
        }

        return NextResponse.json(serviceResult.value)
      }
      // User is authenticated but not a member of this org - fall through to anonymous
    }

    // Get or create anonymous user identifier
    // Generate UUID once and reuse to ensure consistency
    const hasCookie = hasUserIdentifierCookie(request)
    const rawUuid = hasCookie ? getRawUserIdentifierFromRequest(request) : crypto.randomUUID()
    userIdentifier = `anon:${rawUuid}`

    // For anonymous users, we need to get the organization from the comment
    const comment = await db.query.comments.findFirst({
      where: (comments, { eq }) => eq(comments.id, commentId),
    })

    if (!comment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

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

    // Build minimal service context for anonymous users
    ctx = {
      organizationId: board.organizationId,
      userId: '', // Not applicable for anonymous users
      memberId: userIdentifier, // Use the anon identifier as memberId for tracking
      memberRole: 'user', // Anonymous users have minimal permissions
      userName: 'Anonymous',
      userEmail: '',
      userIdentifier, // Pass the user identifier for reaction tracking
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
    let serviceResult

    if (existingReaction) {
      // Remove reaction
      serviceResult = await commentService.removeReaction(commentId, emoji, ctx)
    } else {
      // Add reaction
      serviceResult = await commentService.addReaction(commentId, emoji, ctx)
    }

    // Map Result to HTTP response
    if (!serviceResult.success) {
      const status = getHttpStatusFromError(serviceResult.error)
      return NextResponse.json({ error: serviceResult.error.message }, { status })
    }

    // Set the user identifier cookie if it's a new user
    if (!hasCookie) {
      responseHeaders = new Headers()
      setUserIdentifierCookie(responseHeaders, rawUuid)
    }

    return NextResponse.json(serviceResult.value, { headers: responseHeaders })
  } catch (error) {
    console.error('Error toggling comment reaction:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
