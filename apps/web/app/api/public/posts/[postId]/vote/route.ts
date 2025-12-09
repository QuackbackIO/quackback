import { NextRequest, NextResponse } from 'next/server'
import { db, member, organization, eq, and } from '@quackback/db'
import {
  getRawUserIdentifierFromRequest,
  setUserIdentifierCookie,
  hasUserIdentifierCookie,
  getMemberIdentifier,
} from '@/lib/user-identifier'
import { getSession } from '@/lib/auth/server'
import { getPostService } from '@/lib/services'
import type { ServiceContext } from '@quackback/domain'
import type { PostError } from '@quackback/domain'

interface RouteParams {
  params: Promise<{ postId: string }>
}

/**
 * Map PostError codes to HTTP status codes
 */
function getHttpStatusFromError(error: PostError): number {
  switch (error.code) {
    case 'POST_NOT_FOUND':
    case 'BOARD_NOT_FOUND':
      return 404
    case 'UNAUTHORIZED':
      return 403
    case 'VALIDATION_ERROR':
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

    // Get organization to check if voting is allowed
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, board.organizationId),
    })

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    if (org.portalVoting === 'disabled') {
      return NextResponse.json({ error: 'Voting is disabled' }, { status: 403 })
    }

    // Check for authenticated user
    const session = await getSession()
    let userIdentifier: string
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

        // Call PostService to toggle vote
        const postService = getPostService()
        const result = await postService.voteOnPost(postId, userIdentifier, ctx)

        // Map Result to HTTP response
        if (!result.success) {
          const status = getHttpStatusFromError(result.error)
          return NextResponse.json({ error: result.error.message }, { status })
        }

        return NextResponse.json(result.value)
      }
      // User is authenticated but not a member of this org - fall through to anonymous
    }

    // Anonymous user - check if anonymous voting is allowed
    if (org.portalVoting === 'authenticated') {
      return NextResponse.json(
        { error: 'Authentication required to vote. Please sign in or create an account.' },
        { status: 401 }
      )
    }

    // Get or create anonymous user identifier
    // Generate UUID once and reuse to ensure consistency
    const hasCookie = hasUserIdentifierCookie(request)
    const rawUuid = hasCookie ? getRawUserIdentifierFromRequest(request) : crypto.randomUUID()
    userIdentifier = `anon:${rawUuid}`

    // Build minimal service context for anonymous users
    // Only organizationId is used by voteOnPost service method
    ctx = {
      organizationId: board.organizationId,
      userId: '', // Not applicable for anonymous users
      memberId: '', // Not applicable for anonymous users
      memberRole: 'user', // Anonymous users have minimal permissions
      userName: 'Anonymous',
      userEmail: '',
    }

    // Call PostService to toggle vote
    const postService = getPostService()
    const result = await postService.voteOnPost(postId, userIdentifier, ctx)

    // Map Result to HTTP response
    if (!result.success) {
      const status = getHttpStatusFromError(result.error)
      return NextResponse.json({ error: result.error.message }, { status })
    }

    // Set the user identifier cookie if it's a new user
    if (!hasCookie) {
      responseHeaders = new Headers()
      setUserIdentifierCookie(responseHeaders, rawUuid)
    }

    return NextResponse.json(result.value, { headers: responseHeaders })
  } catch (error) {
    console.error('Error toggling vote:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
