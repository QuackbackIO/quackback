import { NextRequest, NextResponse } from 'next/server'
import { validateApiTenantAccess } from '@/lib/tenant'
import { getPostService } from '@/lib/services'
import { buildServiceContext } from '@quackback/domain'
import type { PostError } from '@quackback/domain'

/**
 * Map PostError codes to HTTP status codes
 */
function getHttpStatusFromError(error: PostError): number {
  switch (error.code) {
    case 'POST_NOT_FOUND':
      return 404
    case 'STATUS_NOT_FOUND':
      return 404
    case 'UNAUTHORIZED':
      return 403
    case 'VALIDATION_ERROR':
      return 400
    default:
      return 500
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  try {
    const { postId } = await params
    const body = await request.json()
    const { organizationId, statusId } = body

    // Validate tenant access (handles auth + org membership check)
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Validate statusId is provided
    if (!statusId) {
      return NextResponse.json({ error: 'statusId is required' }, { status: 400 })
    }

    // Build service context from validation
    const ctx = buildServiceContext(validation)

    // Get PostService and change status
    const postService = getPostService()
    const result = await postService.changeStatus(postId, statusId, ctx)

    // Map Result to HTTP response
    if (!result.success) {
      const status = getHttpStatusFromError(result.error)
      return NextResponse.json({ error: result.error.message }, { status })
    }

    return NextResponse.json(result.value)
  } catch (error) {
    console.error('Error changing post status:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
