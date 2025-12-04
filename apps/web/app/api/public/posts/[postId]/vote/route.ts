import { NextRequest, NextResponse } from 'next/server'
import { togglePublicVote, getBoardByPostId } from '@quackback/db/queries/public'
import { getBoardSettings } from '@quackback/db/types'
import { db, member, organization, eq, and } from '@quackback/db'
import {
  getRawUserIdentifierFromRequest,
  setUserIdentifierCookie,
  hasUserIdentifierCookie,
  getMemberIdentifier,
} from '@/lib/user-identifier'
import { getSession } from '@/lib/auth/server'

interface RouteParams {
  params: Promise<{ postId: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { postId } = await params

  // Get the board to check if voting is allowed
  const board = await getBoardByPostId(postId)
  if (!board || !board.isPublic) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  // Check if public voting is enabled for this board
  const settings = getBoardSettings(board)
  if (!settings.publicVoting) {
    return NextResponse.json({ error: 'Voting is disabled for this board' }, { status: 403 })
  }

  // Check for authenticated user
  const session = await getSession()
  let userIdentifier: string

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

      // Toggle the vote - no need to set cookie for authenticated users
      const result = await togglePublicVote(postId, userIdentifier)
      return NextResponse.json(result)
    }
    // User is authenticated but not a member of this org - fall through to anonymous
  }

  // Anonymous user - check if anonymous voting is allowed
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, board.organizationId),
  })

  if (org?.portalRequireAuth) {
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

  // Toggle the vote
  const result = await togglePublicVote(postId, userIdentifier)

  // Set the user identifier cookie if it's a new user
  const headers = new Headers()
  if (!hasCookie) {
    setUserIdentifierCookie(headers, rawUuid)
  }

  return NextResponse.json(result, { headers })
}
