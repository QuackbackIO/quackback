import { withApiHandlerParams, validateBody, ApiError, successResponse } from '@/lib/api-handler'
import { getPostService } from '@/lib/services'
import { buildServiceContext } from '@quackback/domain'
import { z } from 'zod'

const updatePostTagsSchema = z.object({
  tagIds: z.array(z.string()),
})

type RouteParams = { postId: string }

/**
 * PUT /api/posts/[postId]/tags
 * Update tags assigned to a post
 */
export const PUT = withApiHandlerParams<RouteParams>(async (request, { validation, params }) => {
  const { postId } = params
  const body = await request.json()
  const { tagIds } = validateBody(updatePostTagsSchema, body)

  // Build service context from validation
  const ctx = buildServiceContext(validation)

  // Call PostService to update the post's tags
  const result = await getPostService().updatePost(postId, { tagIds }, ctx)

  // Map Result to HTTP response
  if (!result.success) {
    const error = result.error

    // Map domain errors to HTTP status codes
    switch (error.code) {
      case 'POST_NOT_FOUND':
        throw new ApiError(error.message, 404)
      case 'BOARD_NOT_FOUND':
        throw new ApiError(error.message, 404)
      case 'UNAUTHORIZED':
        throw new ApiError(error.message, 403)
      case 'VALIDATION_ERROR':
        throw new ApiError(error.message, 400)
      case 'INVALID_TAGS':
        throw new ApiError(error.message, 400)
      default:
        throw new ApiError('Internal server error', 500)
    }
  }

  return successResponse({ success: true })
})
