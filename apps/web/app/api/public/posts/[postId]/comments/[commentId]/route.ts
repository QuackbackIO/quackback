import { NextRequest, NextResponse } from 'next/server'
import { db, eq, member, and } from '@/lib/db'
import { getSession } from '@/lib/auth/server'
import { getCommentService } from '@/lib/services'
import type { ServiceContext, CommentError } from '@quackback/domain'
import { isValidTypeId, type CommentId, type MemberId } from '@quackback/ids'

interface RouteParams {
  params: Promise<{ postId: string; commentId: string }>
}

/**
 * Map CommentError codes to HTTP status codes
 */
function getHttpStatusFromError(error: CommentError): number {
  switch (error.code) {
    case 'COMMENT_NOT_FOUND':
    case 'POST_NOT_FOUND':
      return 404
    case 'UNAUTHORIZED':
      return 403
    case 'EDIT_NOT_ALLOWED':
    case 'DELETE_NOT_ALLOWED':
    case 'VALIDATION_ERROR':
    case 'INVALID_PARENT':
      return 400
    case 'ALREADY_DELETED':
      return 410 // Gone
    default:
      return 500
  }
}

/**
 * GET /api/public/posts/[postId]/comments/[commentId]
 * Get comment with edit/delete permissions
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { postId: postIdParam, commentId: commentIdParam } = await params

    // Validate TypeID formats
    if (!isValidTypeId(postIdParam, 'post')) {
      return NextResponse.json({ error: 'Invalid post ID format' }, { status: 400 })
    }
    if (!isValidTypeId(commentIdParam, 'comment')) {
      return NextResponse.json({ error: 'Invalid comment ID format' }, { status: 400 })
    }
    const commentId = commentIdParam as CommentId

    // Get comment context to find organization
    const commentService = getCommentService()
    const contextResult = await commentService.resolveCommentContext(commentId)
    if (!contextResult.success) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

    const { workspaceId } = contextResult.value

    // Get session (optional)
    const session = await getSession()
    let canEdit = false
    let canDelete = false
    let editReason: string | undefined
    let deleteReason: string | undefined

    if (session?.user) {
      // Get member record for this organization
      const memberRecord = await db.query.member.findFirst({
        where: and(eq(member.userId, session.user.id), eq(member.workspaceId, workspaceId)),
      })

      if (memberRecord) {
        const ctx: ServiceContext = {
          workspaceId,
          userId: session.user.id,
          memberId: memberRecord.id as MemberId,
          memberRole: memberRecord.role as 'owner' | 'admin' | 'member' | 'user',
          userName: session.user.name || session.user.email,
          userEmail: session.user.email,
        }

        // Check edit permission
        const editResult = await commentService.canEditComment(commentId, ctx)
        if (editResult.success) {
          canEdit = editResult.value.allowed
          editReason = editResult.value.reason
        }

        // Check delete permission
        const deleteResult = await commentService.canDeleteComment(commentId, ctx)
        if (deleteResult.success) {
          canDelete = deleteResult.value.allowed
          deleteReason = deleteResult.value.reason
        }
      }
    }

    return NextResponse.json({
      canEdit,
      canDelete,
      editReason,
      deleteReason,
    })
  } catch (error) {
    console.error('Error getting comment permissions:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/public/posts/[postId]/comments/[commentId]
 * User edits their own comment
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { postId: postIdParam, commentId: commentIdParam } = await params

    // Validate TypeID formats
    if (!isValidTypeId(postIdParam, 'post')) {
      return NextResponse.json({ error: 'Invalid post ID format' }, { status: 400 })
    }
    if (!isValidTypeId(commentIdParam, 'comment')) {
      return NextResponse.json({ error: 'Invalid comment ID format' }, { status: 400 })
    }
    const commentId = commentIdParam as CommentId

    // Require authentication
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required. Please sign in to edit.' },
        { status: 401 }
      )
    }

    // Get comment context to find organization
    const commentService = getCommentService()
    const contextResult = await commentService.resolveCommentContext(commentId)
    if (!contextResult.success) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

    const { workspaceId } = contextResult.value

    // Get member record for this organization
    const memberRecord = await db.query.member.findFirst({
      where: and(eq(member.userId, session.user.id), eq(member.workspaceId, workspaceId)),
    })

    if (!memberRecord) {
      return NextResponse.json(
        { error: 'You must be a member of this workspace to edit comments.' },
        { status: 403 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { content } = body

    if (!content) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }

    // Build service context
    const ctx: ServiceContext = {
      workspaceId,
      userId: session.user.id,
      memberId: memberRecord.id as MemberId,
      memberRole: memberRecord.role as 'owner' | 'admin' | 'member' | 'user',
      userName: session.user.name || session.user.email,
      userEmail: session.user.email,
    }

    // Call CommentService to edit
    const result = await commentService.userEditComment(commentId, content, ctx)

    if (!result.success) {
      const status = getHttpStatusFromError(result.error)
      return NextResponse.json({ error: result.error.message }, { status })
    }

    return NextResponse.json(result.value)
  } catch (error) {
    console.error('Error editing comment:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/public/posts/[postId]/comments/[commentId]
 * User soft-deletes their own comment
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { postId: postIdParam, commentId: commentIdParam } = await params

    // Validate TypeID formats
    if (!isValidTypeId(postIdParam, 'post')) {
      return NextResponse.json({ error: 'Invalid post ID format' }, { status: 400 })
    }
    if (!isValidTypeId(commentIdParam, 'comment')) {
      return NextResponse.json({ error: 'Invalid comment ID format' }, { status: 400 })
    }
    const commentId = commentIdParam as CommentId

    // Require authentication
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required. Please sign in to delete.' },
        { status: 401 }
      )
    }

    // Get comment context to find organization
    const commentService = getCommentService()
    const contextResult = await commentService.resolveCommentContext(commentId)
    if (!contextResult.success) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

    const { workspaceId } = contextResult.value

    // Get member record for this organization
    const memberRecord = await db.query.member.findFirst({
      where: and(eq(member.userId, session.user.id), eq(member.workspaceId, workspaceId)),
    })

    if (!memberRecord) {
      return NextResponse.json(
        { error: 'You must be a member of this workspace to delete comments.' },
        { status: 403 }
      )
    }

    // Build service context
    const ctx: ServiceContext = {
      workspaceId,
      userId: session.user.id,
      memberId: memberRecord.id as MemberId,
      memberRole: memberRecord.role as 'owner' | 'admin' | 'member' | 'user',
      userName: session.user.name || session.user.email,
      userEmail: session.user.email,
    }

    // Call CommentService to soft delete
    const result = await commentService.softDeleteComment(commentId, ctx)

    if (!result.success) {
      const status = getHttpStatusFromError(result.error)
      return NextResponse.json({ error: result.error.message }, { status })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting comment:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
