import { createServerFn } from '@tanstack/react-start'
import { requireAuth } from './auth-helpers'
import { db, segments, isNull } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'segments' })

/**
 * List all active (non-deleted) segments in the workspace
 * Used by admin UI to display available segments for configuration
 */
export const listSegmentsFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('list segments')
  try {
    await requireAuth({ roles: ['admin'] })

    const allSegments = await db.query.segments.findMany({
      where: isNull(segments.deletedAt),
      columns: {
        id: true,
        name: true,
        slug: true,
        description: true,
        type: true,
        color: true,
      },
      orderBy: (t, { asc }) => [asc(t.name)],
    })

    return allSegments
  } catch (error) {
    log.error({ error }, 'list segments failed')
    throw error
  }
})
