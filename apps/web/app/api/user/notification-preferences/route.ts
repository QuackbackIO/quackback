import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/server'
import { db, member, eq, and } from '@quackback/db'
import { SubscriptionService } from '@quackback/domain/subscriptions'
import { isValidTypeId, type MemberId, type OrgId } from '@quackback/ids'

/**
 * GET /api/user/notification-preferences
 *
 * Get the current user's notification preferences for a specific organization.
 * Query params:
 *   - organizationId: Required. The organization context for preferences.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const organizationIdParam = searchParams.get('organizationId')

    if (!organizationIdParam) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }
    if (!isValidTypeId(organizationIdParam, 'org')) {
      return NextResponse.json({ error: 'Invalid organization ID format' }, { status: 400 })
    }
    const organizationId = organizationIdParam as OrgId

    // Check membership in the organization
    const memberRecord = await db.query.member.findFirst({
      where: and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)),
    })

    if (!memberRecord) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const subscriptionService = new SubscriptionService()
    const memberId = memberRecord.id as MemberId
    const preferences = await subscriptionService.getNotificationPreferences(
      memberId,
      organizationId
    )

    return NextResponse.json(preferences)
  } catch (error) {
    console.error('Error fetching notification preferences:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/user/notification-preferences
 *
 * Update the current user's notification preferences for a specific organization.
 * Body (JSON):
 *   - organizationId: Required. The organization context for preferences.
 *   - emailStatusChange: Optional. Boolean to enable/disable status change emails.
 *   - emailNewComment: Optional. Boolean to enable/disable new comment emails.
 *   - emailMuted: Optional. Boolean to mute all notification emails.
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      organizationId: organizationIdParam,
      emailStatusChange,
      emailNewComment,
      emailMuted,
    } = body

    if (!organizationIdParam) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }
    if (!isValidTypeId(organizationIdParam, 'org')) {
      return NextResponse.json({ error: 'Invalid organization ID format' }, { status: 400 })
    }
    const organizationId = organizationIdParam as OrgId

    // Check membership in the organization
    const memberRecord = await db.query.member.findFirst({
      where: and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)),
    })

    if (!memberRecord) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Build update object only with provided fields
    const updates: {
      emailStatusChange?: boolean
      emailNewComment?: boolean
      emailMuted?: boolean
    } = {}

    if (typeof emailStatusChange === 'boolean') {
      updates.emailStatusChange = emailStatusChange
    }
    if (typeof emailNewComment === 'boolean') {
      updates.emailNewComment = emailNewComment
    }
    if (typeof emailMuted === 'boolean') {
      updates.emailMuted = emailMuted
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const subscriptionService = new SubscriptionService()
    const memberId = memberRecord.id as MemberId
    const preferences = await subscriptionService.updateNotificationPreferences(
      memberId,
      updates,
      organizationId
    )

    return NextResponse.json({
      success: true,
      preferences,
    })
  } catch (error) {
    console.error('Error updating notification preferences:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
