import { NextRequest, NextResponse } from 'next/server'
import { db, member, eq, and } from '@quackback/db'
import { getMemberIdentifier } from '@/lib/user-identifier'
import { getSession } from '@/lib/auth/server'
import { getPostService } from '@/lib/services'
import {
  checkRateLimitRedis,
  rateLimits,
  getClientIp,
  createRateLimitHeaders,
} from '@/lib/rate-limit'
import { hashIP } from '@/lib/utils/ip-hash'
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
    const clientIp = getClientIp(request.headers)

    // Require authentication
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required. Please sign in to vote.' },
        { status: 401 }
      )
    }

    // Rate limit check
    const rateLimitKey = `vote:user:${session.user.id}`
    const globalLimit = await checkRateLimitRedis(rateLimitKey, rateLimits.voteGlobalAuthenticated)
    if (!globalLimit.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: createRateLimitHeaders(globalLimit) }
      )
    }

    const postLimit = await checkRateLimitRedis(
      `${rateLimitKey}:${postId}`,
      rateLimits.votePerPostAuthenticated
    )
    if (!postLimit.success) {
      return NextResponse.json(
        { error: 'Too many votes on this post. Please try again later.' },
        { status: 429, headers: createRateLimitHeaders(postLimit) }
      )
    }

    // Hash IP for privacy-preserving storage
    const ipHash = hashIP(clientIp, process.env.BETTER_AUTH_SECRET || 'default-salt')

    // Get the board to find organization
    const boardResult = await getPostService().getBoardByPostId(postId)
    const board = boardResult.success ? boardResult.value : null
    if (!board) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    // Get member record for this organization
    const memberRecord = await db.query.member.findFirst({
      where: and(
        eq(member.userId, session.user.id),
        eq(member.organizationId, board.organizationId)
      ),
    })

    if (!memberRecord) {
      return NextResponse.json(
        { error: 'You must be a member of this workspace to vote.' },
        { status: 403 }
      )
    }

    // Team members can vote on any board; portal users only on public boards
    const isTeamMember = ['owner', 'admin', 'member'].includes(memberRecord.role)
    if (!board.isPublic && !isTeamMember) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
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

    // Call PostService to toggle vote
    const postService = getPostService()
    const result = await postService.voteOnPost(postId, userIdentifier, ctx, {
      memberId: memberRecord.id,
      ipHash,
    })

    if (!result.success) {
      const status = getHttpStatusFromError(result.error)
      return NextResponse.json({ error: result.error.message }, { status })
    }

    return NextResponse.json(result.value)
  } catch (error) {
    console.error('Error toggling vote:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
