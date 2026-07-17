import { createFileRoute } from '@tanstack/react-router'
import type { Role } from '@/lib/shared/roles'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'export-runs' })

/**
 * GET /api/export/runs - export history for the hub page. Newest first,
 * capped list; the hub polls in-flight runs by id via GET .../runs/{id}.
 */
export async function handleListExportRuns(): Promise<Response> {
  const { validateApiWorkspaceAccess } = await import('@/lib/server/functions/workspace')
  const { canAccess } = await import('@/lib/server/auth')
  const { listExportRuns } = await import('@/lib/server/domains/export/export-run.service')

  try {
    const validation = await validateApiWorkspaceAccess()
    if (!validation.success) {
      return Response.json({ error: validation.error }, { status: validation.status })
    }

    if (!canAccess(validation.principal.role as Role, ['admin'])) {
      return Response.json({ error: 'Only admins can view export history' }, { status: 403 })
    }

    const runs = await listExportRuns()
    return Response.json({ runs })
  } catch (error) {
    log.error({ err: error }, 'list export runs failed')
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const Route = createFileRoute('/api/export/runs')({
  server: {
    handlers: {
      GET: () => handleListExportRuns(),
    },
  },
})
