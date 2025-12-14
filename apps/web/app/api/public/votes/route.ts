import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/server'
import { getPostService } from '@/lib/services'
import { db, member, eq, and } from '@quackback/db'
import { getMemberIdentifier } from '@/lib/user-identifier'

/**
 * GET /api/public/votes
 * Returns which posts the current user has voted on.
 * Query params:
 *   - organizationId: required
 *   - postIds: comma-separated list of post IDs to check
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')
    const postIdsParam = searchParams.get('postIds')

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }

    if (!postIdsParam) {
      return NextResponse.json({ votedPostIds: [] })
    }

    const postIds = postIdsParam.split(',').filter(Boolean)
    if (postIds.length === 0) {
      return NextResponse.json({ votedPostIds: [] })
    }

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

    // Get voted post IDs
    const result = await getPostService().getUserVotedPostIds(postIds, userIdentifier)
    if (!result.success) {
      return NextResponse.json({ votedPostIds: [] })
    }

    return NextResponse.json({ votedPostIds: Array.from(result.value) })
  } catch (error) {
    console.error('Error fetching voted posts:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
