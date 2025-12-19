import { NextRequest, NextResponse } from 'next/server'
import { validateApiTenantAccess } from '@/lib/tenant'
import { getPostService } from '@/lib/services'
import { buildServiceContext, type PostError } from '@quackback/domain'
import { isValidTypeId, type PostId } from '@quackback/ids'

/**
 * Map PostError codes to HTTP status codes
 */
function getHttpStatusFromError(error: PostError): number {
  switch (error.code) {
    case 'POST_NOT_FOUND':
      return 404
    case 'UNAUTHORIZED':
      return 403
    case 'VALIDATION_ERROR':
      return 400
    default:
      return 500
  }
}

/**
 * POST /api/posts/[postId]/restore
 * Admin restores a soft-deleted post
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  try {
    const { postId: postIdParam } = await params
    const body = await request.json()
    const { workspaceId } = body

    // Validate TypeID format
    if (!isValidTypeId(postIdParam, 'post')) {
      return NextResponse.json({ error: 'Invalid post ID format' }, { status: 400 })
    }
    const postId = postIdParam as PostId

    // Validate tenant access (handles auth + org membership check)
    const validation = await validateApiTenantAccess(workspaceId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Only admins and owners can restore posts
    if (!['admin', 'owner'].includes(validation.member.role)) {
      return NextResponse.json({ error: 'Only admins can restore deleted posts' }, { status: 403 })
    }

    // Build service context from validation
    const ctx = buildServiceContext(validation)

    // Restore the post
    const result = await getPostService().restorePost(postId, ctx)

    if (!result.success) {
      const status = getHttpStatusFromError(result.error)
      return NextResponse.json({ error: result.error.message }, { status })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error restoring post:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
