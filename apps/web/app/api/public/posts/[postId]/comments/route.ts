import { NextRequest, NextResponse } from 'next/server'
import { db, organization, eq, member, and } from '@quackback/db'
import {
  getRawUserIdentifierFromRequest,
  setUserIdentifierCookie,
  hasUserIdentifierCookie,
} from '@/lib/user-identifier'
import { commentSchema } from '@/lib/schemas/comments'
import { getSession } from '@/lib/auth/server'
import { getCommentService, getPostService } from '@/lib/services'
import type { ServiceContext, CommentError } from '@quackback/domain'

interface RouteParams {
  params: Promise<{ postId: string }>
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
    const { postId } = await params

    // Get the board to find organization
    const boardResult = await getPostService().getBoardByPostId(postId)
    const board = boardResult.success ? boardResult.value : null
    if (!board || !board.isPublic) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    // Get organization to check settings
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, board.organizationId),
    })

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    // Parse and validate request body
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const result = commentSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0]?.message || 'Invalid input' },
        { status: 400 }
      )
    }

    const { content, authorName, authorEmail, parentId } = result.data

    // Check for authenticated user FIRST - team members can always comment
    const session = await getSession()
    let ctx: ServiceContext
    let responseHeaders: Headers | undefined

    if (session?.user) {
      // Authenticated user - get their member record for this organization
      const memberRecord = await db.query.member.findFirst({
        where: and(
          eq(member.userId, session.user.id),
          eq(member.organizationId, board.organizationId)
        ),
      })

      if (memberRecord) {
        // Team members can always comment, regardless of portalPublicCommenting setting
        // Build full service context for authenticated users
        ctx = {
          organizationId: board.organizationId,
          userId: session.user.id,
          memberId: memberRecord.id,
          memberRole: memberRecord.role as 'owner' | 'admin' | 'member' | 'user',
          userName: session.user.name || session.user.email,
          userEmail: session.user.email,
        }

        // Call CommentService to create the comment
        const commentService = getCommentService()
        const serviceResult = await commentService.createComment(
          {
            postId,
            content,
            parentId: parentId || null,
            authorName: authorName || null,
            authorEmail: authorEmail || null,
          },
          ctx
        )

        // Map Result to HTTP response
        if (!serviceResult.success) {
          const status = getHttpStatusFromError(serviceResult.error)
          return NextResponse.json({ error: serviceResult.error.message }, { status })
        }

        return NextResponse.json(serviceResult.value, { status: 201 })
      }
      // User is authenticated but not a member of this org - fall through to public user checks
    }

    // For non-team-members, check if public commenting is enabled
    if (!org.portalPublicCommenting) {
      return NextResponse.json({ error: 'Commenting is disabled' }, { status: 403 })
    }

    // Check if anonymous commenting is allowed
    if (org.portalRequireAuth) {
      return NextResponse.json(
        { error: 'Authentication required to comment. Please sign in or create an account.' },
        { status: 401 }
      )
    }

    // Get or create anonymous user identifier
    // Generate UUID once and reuse to ensure consistency
    const hasCookie = hasUserIdentifierCookie(request)
    const rawUuid = hasCookie ? getRawUserIdentifierFromRequest(request) : crypto.randomUUID()
    const userIdentifier = `anon:${rawUuid}`

    // Build minimal service context for anonymous users
    // Anonymous users need a memberId, so we create a temporary one based on their identifier
    // The service will use this to track comment authorship
    ctx = {
      organizationId: board.organizationId,
      userId: '', // Not applicable for anonymous users
      memberId: userIdentifier, // Use the anon identifier as memberId for tracking
      memberRole: 'user', // Anonymous users have minimal permissions
      userName: authorName || 'Anonymous',
      userEmail: authorEmail || '',
      userIdentifier, // Pass the user identifier for reaction tracking
    }

    // Call CommentService to create the comment
    const commentService = getCommentService()
    const serviceResult = await commentService.createComment(
      {
        postId,
        content,
        parentId: parentId || null,
        authorName: authorName || null,
        authorEmail: authorEmail || null,
      },
      ctx
    )

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

    return NextResponse.json(serviceResult.value, { status: 201, headers: responseHeaders })
  } catch (error) {
    console.error('Error creating comment:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
