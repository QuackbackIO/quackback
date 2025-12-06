import { reorderStatuses, type StatusCategory } from '@quackback/db'
import { withApiHandler, validateBody, successResponse } from '@/lib/api-handler'
import { z } from 'zod'

const reorderSchema = z.object({
  category: z.enum(['active', 'complete', 'closed']),
  statusIds: z.array(z.string().uuid()).min(1),
})

/**
 * PUT /api/statuses/reorder
 * Reorder statuses within a category
 */
export const PUT = withApiHandler(async (request, { validation }) => {
  const body = await request.json()
  const { category, statusIds } = validateBody(reorderSchema, body)

  // Reorder the statuses
  await reorderStatuses(validation.organization.id, category as StatusCategory, statusIds)

  return successResponse({ success: true })
})
