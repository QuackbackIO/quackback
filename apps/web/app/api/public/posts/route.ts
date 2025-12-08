import { NextRequest, NextResponse } from 'next/server'
import { getPostService } from '@/lib/services'
import type { PostError } from '@quackback/domain'

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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }

    // Parse filter params
    const boardSlug = searchParams.get('board') || undefined
    const search = searchParams.get('search') || undefined
    const sort = (searchParams.get('sort') as 'top' | 'new' | 'trending') || 'top'
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '20', 10)

    // Parse array params (status and tagIds can have multiple values)
    const status = searchParams.getAll('status').filter(Boolean)
    const tagIds = searchParams.getAll('tagIds').filter(Boolean)

    // Call PostService to list public posts
    const postService = getPostService()
    const result = await postService.listPublicPosts({
      organizationId,
      boardSlug,
      search,
      status: status.length > 0 ? status : undefined,
      tagIds: tagIds.length > 0 ? tagIds : undefined,
      sort,
      page,
      limit,
    })

    // Map Result to HTTP response
    if (!result.success) {
      const status = getHttpStatusFromError(result.error)
      return NextResponse.json({ error: result.error.message }, { status })
    }

    return NextResponse.json(result.value)
  } catch (error) {
    console.error('Error fetching public posts:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
