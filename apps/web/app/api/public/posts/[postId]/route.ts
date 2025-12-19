import { NextRequest, NextResponse } from 'next/server'
import { db, member, eq, and } from '@/lib/db'
import { getSession } from '@/lib/auth/server'
import { getPostService } from '@/lib/services'
import type { ServiceContext } from '@quackback/domain'
import type { PostError } from '@quackback/domain'
import { isValidTypeId, type PostId, type MemberId } from '@quackback/ids'

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
    case 'EDIT_NOT_ALLOWED':
    case 'DELETE_NOT_ALLOWED':
    case 'VALIDATION_ERROR':
      return 400
    case 'ALREADY_DELETED':
      return 410 // Gone
    default:
      return 500
  }
}

/**
 * GET /api/public/posts/[postId]
 * Get post details with edit/delete permissions
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { postId: postIdParam } = await params

    // Validate TypeID format
    if (!isValidTypeId(postIdParam, 'post')) {
      return NextResponse.json({ error: 'Invalid post ID format' }, { status: 400 })
    }
    const postId = postIdParam as PostId

    // Get the board to find organization
    const boardResult = await getPostService().getBoardByPostId(postId)
    const board = boardResult.success ? boardResult.value : null
    if (!board) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    // Get session (optional - public posts can be viewed without auth)
    const session = await getSession()
    let canEdit = false
    let canDelete = false
    let editReason: string | undefined
    let deleteReason: string | undefined

    if (session?.user) {
      // Get member record for this organization
      const memberRecord = await db.query.member.findFirst({
        where: and(eq(member.userId, session.user.id), eq(member.workspaceId, board.workspaceId)),
      })

      if (memberRecord) {
        const ctx: ServiceContext = {
          workspaceId: board.workspaceId,
          userId: session.user.id,
          memberId: memberRecord.id as MemberId,
          memberRole: memberRecord.role as 'owner' | 'admin' | 'member' | 'user',
          userName: session.user.name || session.user.email,
          userEmail: session.user.email,
        }

        const postService = getPostService()

        // Check edit permission
        const editResult = await postService.canEditPost(postId, ctx)
        if (editResult.success) {
          canEdit = editResult.value.allowed
          editReason = editResult.value.reason
        }

        // Check delete permission
        const deleteResult = await postService.canDeletePost(postId, ctx)
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
    console.error('Error getting post permissions:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/public/posts/[postId]
 * User edits their own post
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
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
        { error: 'Authentication required. Please sign in to edit.' },
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
      where: and(eq(member.userId, session.user.id), eq(member.workspaceId, board.workspaceId)),
    })

    if (!memberRecord) {
      return NextResponse.json(
        { error: 'You must be a member of this workspace to edit posts.' },
        { status: 403 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { title, content, contentJson } = body

    if (!title || !content) {
      return NextResponse.json({ error: 'Title and content are required' }, { status: 400 })
    }

    // Build service context
    const ctx: ServiceContext = {
      workspaceId: board.workspaceId,
      userId: session.user.id,
      memberId: memberRecord.id as MemberId,
      memberRole: memberRecord.role as 'owner' | 'admin' | 'member' | 'user',
      userName: session.user.name || session.user.email,
      userEmail: session.user.email,
    }

    // Call PostService to edit
    const postService = getPostService()
    const result = await postService.userEditPost(postId, { title, content, contentJson }, ctx)

    if (!result.success) {
      const status = getHttpStatusFromError(result.error)
      return NextResponse.json({ error: result.error.message }, { status })
    }

    return NextResponse.json(result.value)
  } catch (error) {
    console.error('Error editing post:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/public/posts/[postId]
 * User soft-deletes their own post
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
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
        { error: 'Authentication required. Please sign in to delete.' },
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
      where: and(eq(member.userId, session.user.id), eq(member.workspaceId, board.workspaceId)),
    })

    if (!memberRecord) {
      return NextResponse.json(
        { error: 'You must be a member of this workspace to delete posts.' },
        { status: 403 }
      )
    }

    // Build service context
    const ctx: ServiceContext = {
      workspaceId: board.workspaceId,
      userId: session.user.id,
      memberId: memberRecord.id as MemberId,
      memberRole: memberRecord.role as 'owner' | 'admin' | 'member' | 'user',
      userName: session.user.name || session.user.email,
      userEmail: session.user.email,
    }

    // Call PostService to soft delete
    const postService = getPostService()
    const result = await postService.softDeletePost(postId, ctx)

    if (!result.success) {
      const status = getHttpStatusFromError(result.error)
      return NextResponse.json({ error: result.error.message }, { status })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting post:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
