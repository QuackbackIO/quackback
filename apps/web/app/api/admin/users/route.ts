import { withApiHandler, ApiError, successResponse } from '@/lib/api-handler'
import { getUserService } from '@/lib/services'

/**
 * GET /api/admin/users
 *
 * List portal users for the organization.
 * Portal users have role='user' in the member table.
 * Supports filtering by search, verified status, date range, and sorting.
 */
export const GET = withApiHandler(
  async (request, { validation }) => {
    const { searchParams } = new URL(request.url)

    // Parse filter params
    const search = searchParams.get('search') || undefined
    const verifiedParam = searchParams.get('verified')
    const verified = verifiedParam === 'true' ? true : verifiedParam === 'false' ? false : undefined
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const sort =
      (searchParams.get('sort') as 'newest' | 'oldest' | 'most_active' | 'name') || 'newest'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))

    const result = await getUserService().listPortalUsers(validation.organization.id, {
      search,
      verified,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      sort,
      page,
      limit,
    })

    if (!result.success) {
      throw new ApiError(result.error.message, 500)
    }

    return successResponse(result.value)
  },
  { roles: ['owner', 'admin', 'member'] }
)
