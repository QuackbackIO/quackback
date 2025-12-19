import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/server'
import { db, member, posts, eq, and } from '@/lib/db'
import { SubscriptionService } from '@quackback/domain/subscriptions'
import { isValidTypeId, type PostId } from '@quackback/ids'

interface RouteParams {
  params: Promise<{ postId: string }>
}

/**
 * GET /api/posts/[postId]/subscription
 *
 * Get the current user's subscription status for a post.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { postId: postIdParam } = await params

    // Validate TypeID format
    if (!isValidTypeId(postIdParam, 'post')) {
      return NextResponse.json({ error: 'Invalid post ID format' }, { status: 400 })
    }
    const postId = postIdParam as PostId

    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get post to find organization
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: { board: { columns: { workspaceId: true } } },
    })

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    const workspaceId = post.board.workspaceId

    // Get member record
    const memberRecord = await db.query.member.findFirst({
      where: and(eq(member.userId, session.user.id), eq(member.workspaceId, workspaceId)),
    })

    if (!memberRecord) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const subscriptionService = new SubscriptionService()
    const memberId = memberRecord.id
    const status = await subscriptionService.getSubscriptionStatus(memberId, postId, workspaceId)

    return NextResponse.json(status)
  } catch (error) {
    console.error('Error fetching subscription status:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/posts/[postId]/subscription
 *
 * Subscribe to a post.
 * Body (JSON):
 *   - reason: Optional. 'manual' (default) | 'author' | 'vote' | 'comment'
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { postId: postIdParam } = await params

    // Validate TypeID format
    if (!isValidTypeId(postIdParam, 'post')) {
      return NextResponse.json({ error: 'Invalid post ID format' }, { status: 400 })
    }
    const postId = postIdParam as PostId

    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get post to find organization
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: { board: { columns: { workspaceId: true } } },
    })

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    const workspaceId = post.board.workspaceId

    // Get member record
    const memberRecord = await db.query.member.findFirst({
      where: and(eq(member.userId, session.user.id), eq(member.workspaceId, workspaceId)),
    })

    if (!memberRecord) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const reason = body.reason || 'manual'

    const subscriptionService = new SubscriptionService()
    const memberId = memberRecord.id
    await subscriptionService.subscribeToPost(memberId, postId, reason, workspaceId)

    return NextResponse.json({
      success: true,
      subscribed: true,
      muted: false,
      reason,
    })
  } catch (error) {
    console.error('Error subscribing to post:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/posts/[postId]/subscription
 *
 * Unsubscribe from a post.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { postId: postIdParam } = await params

    // Validate TypeID format
    if (!isValidTypeId(postIdParam, 'post')) {
      return NextResponse.json({ error: 'Invalid post ID format' }, { status: 400 })
    }
    const postId = postIdParam as PostId

    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get post to find organization
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: { board: { columns: { workspaceId: true } } },
    })

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    const workspaceId = post.board.workspaceId

    // Get member record
    const memberRecord = await db.query.member.findFirst({
      where: and(eq(member.userId, session.user.id), eq(member.workspaceId, workspaceId)),
    })

    if (!memberRecord) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const subscriptionService = new SubscriptionService()
    const memberId = memberRecord.id
    await subscriptionService.unsubscribeFromPost(memberId, postId, workspaceId)

    return NextResponse.json({
      success: true,
      subscribed: false,
      muted: false,
      reason: null,
    })
  } catch (error) {
    console.error('Error unsubscribing from post:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/posts/[postId]/subscription
 *
 * Update subscription settings (mute/unmute).
 * Body (JSON):
 *   - muted: boolean
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { postId: postIdParam } = await params

    // Validate TypeID format
    if (!isValidTypeId(postIdParam, 'post')) {
      return NextResponse.json({ error: 'Invalid post ID format' }, { status: 400 })
    }
    const postId = postIdParam as PostId

    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    if (typeof body.muted !== 'boolean') {
      return NextResponse.json({ error: 'muted field is required' }, { status: 400 })
    }

    // Get post to find organization
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, postId),
      with: { board: { columns: { workspaceId: true } } },
    })

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    const workspaceId = post.board.workspaceId

    // Get member record
    const memberRecord = await db.query.member.findFirst({
      where: and(eq(member.userId, session.user.id), eq(member.workspaceId, workspaceId)),
    })

    if (!memberRecord) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const subscriptionService = new SubscriptionService()
    const memberId = memberRecord.id
    await subscriptionService.setSubscriptionMuted(memberId, postId, body.muted, workspaceId)

    // Get updated status
    const status = await subscriptionService.getSubscriptionStatus(memberId, postId, workspaceId)

    return NextResponse.json({
      success: true,
      ...status,
    })
  } catch (error) {
    console.error('Error updating subscription:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
