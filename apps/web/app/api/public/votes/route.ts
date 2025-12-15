import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/server'
import { getPostService } from '@/lib/services'
import { db, member, eq, and } from '@quackback/db'
import { getMemberIdentifier } from '@/lib/user-identifier'
import { isValidTypeId, type OrgId } from '@quackback/ids'

/**
 * GET /api/public/votes
 * Returns all posts the current user has voted on.
 * Query params:
 *   - organizationId: required
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationIdParam = searchParams.get('organizationId')

    if (!organizationIdParam) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }
    if (!isValidTypeId(organizationIdParam, 'org')) {
      return NextResponse.json({ error: 'Invalid organization ID format' }, { status: 400 })
    }
    const organizationId = organizationIdParam as OrgId

    // Get current user's member ID
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ votedPostIds: [] })
    }

    const memberRecord = await db.query.member.findFirst({
      where: and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)),
    })

    if (!memberRecord) {
      return NextResponse.json({ votedPostIds: [] })
    }

    const userIdentifier = getMemberIdentifier(memberRecord.id)

    // Get all voted post IDs for this user
    const result = await getPostService().getAllUserVotedPostIds(userIdentifier)
    if (!result.success) {
      return NextResponse.json({ votedPostIds: [] })
    }

    // Service returns TypeIDs directly
    const votedPostIds = Array.from(result.value)

    return NextResponse.json({ votedPostIds })
  } catch (error) {
    console.error('Error fetching voted posts:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
