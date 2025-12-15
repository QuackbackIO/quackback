import { withApiHandler, validateBody, ApiError, successResponse, parseId } from '@/lib/api-handler'
import { createPostSchema, type CreatePostInput } from '@/lib/schemas/posts'
import { getPostService } from '@/lib/services'
import { buildServiceContext } from '@quackback/domain'
import { isValidTypeId, type StatusId } from '@quackback/ids'

export const GET = withApiHandler(async (request, { validation }) => {
  const { searchParams } = new URL(request.url)

  // Parse filter params - convert TypeIDs to UUIDs for database queries
  const boardIds = searchParams.getAll('board').map((id) => parseId(id, 'board'))
  const tagIds = searchParams.getAll('tags').map((id) => parseId(id, 'tag'))
  const ownerParam = searchParams.get('owner')
  const search = searchParams.get('search') || undefined
  const dateFrom = searchParams.get('dateFrom')
  const dateTo = searchParams.get('dateTo')
  const minVotes = searchParams.get('minVotes')
  const sort = (searchParams.get('sort') as 'newest' | 'oldest' | 'votes') || 'newest'
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

  // Handle owner filter - 'unassigned' means null
  let ownerId: string | null | undefined
  if (ownerParam === 'unassigned') {
    ownerId = null
  } else if (ownerParam) {
    ownerId = parseId(ownerParam, 'member')
  }

  // Build service context from validation
  const ctx = buildServiceContext(validation)

  // Call PostService to list inbox posts
  const result = await getPostService().listInboxPosts(
    {
      boardIds: boardIds.length > 0 ? boardIds : undefined,
      statusIds: statusIds.length > 0 ? statusIds : undefined,
      statusSlugs: statusSlugs.length > 0 ? statusSlugs : undefined,
      tagIds: tagIds.length > 0 ? tagIds : undefined,
      ownerId,
      search,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      minVotes: minVotes ? parseInt(minVotes, 10) : undefined,
      sort,
      page,
      limit,
    },
    ctx
  )

  // Map Result to HTTP response
  if (!result.success) {
    throw new ApiError('Failed to fetch posts', 500)
  }

  // Response is already in TypeID format from service layer
  return successResponse(result.value)
})

export const POST = withApiHandler(async (request, { validation }) => {
  const body = await request.json()
  // Schema validates TypeID formats via boardIdSchema, statusIdSchema, tagIdsSchema
  const input = validateBody(createPostSchema, body) as CreatePostInput

  // Build service context from validation
  const ctx = buildServiceContext(validation)

  // Call PostService to create the post (service accepts TypeIDs directly)
  const result = await getPostService().createPost(input, ctx)

  // Map Result to HTTP response
  if (!result.success) {
    const error = result.error

    // Map domain errors to HTTP status codes
    switch (error.code) {
      case 'BOARD_NOT_FOUND':
        throw new ApiError(error.message, 404)
      case 'POST_NOT_FOUND':
        throw new ApiError(error.message, 404)
      case 'VALIDATION_ERROR':
        throw new ApiError(error.message, 400)
      case 'UNAUTHORIZED':
        throw new ApiError(error.message, 403)
      case 'INVALID_TAGS':
        throw new ApiError(error.message, 400)
      default:
        throw new ApiError('Internal server error', 500)
    }
  }

  // Response is already in TypeID format from service layer
  return successResponse(result.value, 201)
})
