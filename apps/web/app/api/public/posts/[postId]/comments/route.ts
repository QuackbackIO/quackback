import { NextRequest, NextResponse } from 'next/server'
import { db, eq, member, and } from '@/lib/db'
import { commentSchema } from '@/lib/schemas/comments'
import { getSession } from '@/lib/auth/server'
import { getCommentService, getPostService } from '@/lib/services'
import { buildCommentCreatedEvent, type ServiceContext, type CommentError } from '@quackback/domain'
import { isValidTypeId, type PostId, type CommentId } from '@quackback/ids'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getJobAdapter, isCloudflareWorker } from '@quackback/jobs'

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
    const { postId: postIdParam } = await params

    // Validate TypeID format
    if (!isValidTypeId(postIdParam, 'post')) {
      return NextResponse.json({ error: 'Invalid post ID format' }, { status: 400 })
    }
    const postId = postIdParam as PostId

    // Require authentication
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required. Please sign in to comment.' },
        { status: 401 }
      )
    }

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
        { error: 'You must be a member of this workspace to comment.' },
        { status: 403 }
      )
    }

    // Team members can comment on any board; portal users only on public boards
    const isTeamMember = ['owner', 'admin', 'member'].includes(memberRecord.role)
    if (!board.isPublic && !isTeamMember) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
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

    const { content, parentId } = result.data

    // Build service context
    const ctx: ServiceContext = {
      organizationId: board.organizationId,
      userId: session.user.id,
      memberId: memberRecord.id,
      memberRole: memberRecord.role as 'owner' | 'admin' | 'member' | 'user',
      userName: session.user.name || session.user.email,
      userEmail: session.user.email,
    }

    // Validate parentId TypeID if present
    let parentIdTypeId: CommentId | null = null
    if (parentId) {
      if (!isValidTypeId(parentId, 'comment')) {
        return NextResponse.json({ error: 'Invalid parent comment ID format' }, { status: 400 })
      }
      parentIdTypeId = parentId as CommentId
    }

    // Call CommentService to create the comment
    const commentService = getCommentService()
    const serviceResult = await commentService.createComment(
      {
        postId,
        content,
        parentId: parentIdTypeId,
        authorName: null, // Always use authenticated user's name
        authorEmail: null, // Always use authenticated user's email
      },
      ctx
    )

    if (!serviceResult.success) {
      const status = getHttpStatusFromError(serviceResult.error)
      return NextResponse.json({ error: serviceResult.error.message }, { status })
    }

    // Trigger EventWorkflow for integrations and notifications
    const { comment, post } = serviceResult.value
    const eventData = buildCommentCreatedEvent(
      ctx.organizationId,
      { type: 'user', userId: ctx.userId, email: ctx.userEmail },
      { id: comment.id, content: comment.content, authorEmail: ctx.userEmail },
      { id: post.id, title: post.title }
    )
    const env = isCloudflareWorker() ? getCloudflareContext().env : undefined
    const jobAdapter = getJobAdapter(env)
    await jobAdapter.addEventJob(eventData)

    // Response is already in TypeID format from service layer
    return NextResponse.json(comment, { status: 201 })
  } catch (error) {
    console.error('Error creating comment:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
