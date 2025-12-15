import { NextRequest, NextResponse } from 'next/server'
import { getPostService } from '@/lib/services'
import type { PostError } from '@quackback/domain'
import { isValidTypeId, type TagId, type StatusId, type OrgId } from '@quackback/ids'

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
    const organizationIdParam = searchParams.get('organizationId')

    if (!organizationIdParam) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }

    if (!isValidTypeId(organizationIdParam, 'org')) {
      return NextResponse.json({ error: 'Invalid organization ID format' }, { status: 400 })
    }
    const organizationId = organizationIdParam as OrgId

    // Parse filter params
    const boardSlug = searchParams.get('board') || undefined
    const search = searchParams.get('search') || undefined
    const sort = (searchParams.get('sort') as 'top' | 'new' | 'trending') || 'top'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))

    // Parse status filter - supports both TypeIDs (status_xxx) and slugs (open, planned)
    const statusParams = searchParams.getAll('status')
    const statusSlugs: string[] = []
    const statusIds: StatusId[] = []
    for (const s of statusParams) {
      if (isValidTypeId(s, 'status')) {
        statusIds.push(s as StatusId)
      } else {
        statusSlugs.push(s)
      }
    }

    // Parse tag filter - only include valid TypeIDs
    const tagIds = searchParams.getAll('tagIds').filter((id) => isValidTypeId(id, 'tag')) as TagId[]

    // Call PostService to list public posts
    const postService = getPostService()
    const result = await postService.listPublicPosts({
      organizationId,
      boardSlug,
      search,
      statusIds: statusIds.length > 0 ? statusIds : undefined,
      statusSlugs: statusSlugs.length > 0 ? statusSlugs : undefined,
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

    // Response is already in TypeID format from service layer
    return NextResponse.json(result.value)
  } catch (error) {
    console.error('Error fetching public posts:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
