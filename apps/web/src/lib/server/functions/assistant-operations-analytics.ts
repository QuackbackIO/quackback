/**
 * The Improve page's operational drill-down (QUINN-PRODUCT Step 11, P8).
 *
 * Same gate and same range contract as the other Quinn reporting reads, so the
 * page asks one question of one permission: `analytics.view` over an explicit
 * [from, to). Nothing here is item-scoped, because nothing here names an item.
 */
import { createServerFn } from '@tanstack/react-start'
import { getQuinnOperations } from '@/lib/server/domains/analytics/quinn-operations'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { dateRangeSchema } from '@/lib/shared/schemas'

export const getQuinnOperationsFn = createServerFn({ method: 'GET' })
  .validator(dateRangeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ANALYTICS_VIEW })
    return getQuinnOperations(new Date(data.from), new Date(data.to))
  })
