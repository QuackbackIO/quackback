import { NextRequest, NextResponse } from 'next/server'
import { getPostService } from '@/lib/services'
import type { PostError } from '@quackback/domain'
import { isValidTypeId, type StatusId, type OrgId } from '@quackback/ids'

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
    case 'VALIDATION_ERROR':
      return 400
    default:
      return 500
  }
}

/**
 * GET /api/public/roadmap/posts
 *
 * Get paginated posts for roadmap view filtered by a single status.
 * Used by the roadmap kanban board for infinite scroll per column.
 *
 * Query params:
 * - organizationId (required): Organization ID
 * - statusId (required): Single status ID to filter by
 * - page (optional, default 1): Page number
 * - limit (optional, default 10): Items per page
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationIdParam = searchParams.get('organizationId')
    const statusIdParam = searchParams.get('statusId')

    if (!organizationIdParam) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }

    if (!isValidTypeId(organizationIdParam, 'org')) {
      return NextResponse.json({ error: 'Invalid organization ID format' }, { status: 400 })
    }
    const organizationId = organizationIdParam as OrgId

    if (!statusIdParam) {
      return NextResponse.json({ error: 'statusId is required' }, { status: 400 })
    }

    if (!isValidTypeId(statusIdParam, 'status')) {
      return NextResponse.json({ error: 'Invalid status ID format' }, { status: 400 })
    }
    const statusId = statusIdParam as StatusId

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)))

    const postService = getPostService()
    const result = await postService.getRoadmapPostsPaginated({
      organizationId,
      statusId,
      page,
      limit,
    })

    if (!result.success) {
      const status = getHttpStatusFromError(result.error)
      return NextResponse.json({ error: result.error.message }, { status })
    }

    // Response is already in TypeID format from service layer
    return NextResponse.json(result.value)
  } catch (error) {
    console.error('Error fetching roadmap posts:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
