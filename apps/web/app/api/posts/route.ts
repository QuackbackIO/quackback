import { withApiHandler, validateBody, ApiError, successResponse } from '@/lib/api-handler'
import { createPostSchema, type PostStatus } from '@/lib/schemas/posts'
import { getPostService } from '@/lib/services'
import { buildServiceContext } from '@quackback/domain'

export const GET = withApiHandler(async (request, { validation }) => {
  const { searchParams } = new URL(request.url)

  // Parse filter params
  const boardIds = searchParams.getAll('board')
  const status = searchParams.getAll('status') as PostStatus[]
  const tagIds = searchParams.getAll('tags')
  const ownerParam = searchParams.get('owner')
  const search = searchParams.get('search') || undefined
  const dateFrom = searchParams.get('dateFrom')
  const dateTo = searchParams.get('dateTo')
  const minVotes = searchParams.get('minVotes')
  const sort = (searchParams.get('sort') as 'newest' | 'oldest' | 'votes') || 'newest'
  const page = parseInt(searchParams.get('page') || '1', 10)
  const limit = parseInt(searchParams.get('limit') || '20', 10)

  // Handle owner filter - 'unassigned' means null
  let ownerId: string | null | undefined
  if (ownerParam === 'unassigned') {
    ownerId = null
  } else if (ownerParam) {
    ownerId = ownerParam
  }

  // Build service context from validation
  const ctx = buildServiceContext(validation)

  // Call PostService to list inbox posts
  const result = await getPostService().listInboxPosts(
    {
      boardIds: boardIds.length > 0 ? boardIds : undefined,
      status: status.length > 0 ? status : undefined,
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

  return successResponse(result.value)
})

export const POST = withApiHandler(async (request, { validation }) => {
  const body = await request.json()
  const input = validateBody(createPostSchema, body)

  // Build service context from validation
  const ctx = buildServiceContext(validation)

  // Call PostService to create the post
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

  return successResponse(result.value, 201)
})
