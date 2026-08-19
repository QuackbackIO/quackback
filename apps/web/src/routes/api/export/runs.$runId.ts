import { createFileRoute } from '@tanstack/react-router'
import type { Role } from '@/lib/shared/roles'
import { isValidTypeId } from '@quackback/ids'
import type { ExportRunId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'export-run' })

/**
 * GET /api/export/runs/{runId} - poll a single export run's status. The hub
 * polls this while a run is pending/running, then renders size + entity
 * counts once it lands on completed/failed.
 */
export async function handleGetExportRun(runId: string): Promise<Response> {
  const { validateApiWorkspaceAccess } = await import('@/lib/server/functions/workspace')
  const { canAccess } = await import('@/lib/server/auth')
  const { getExportRun } = await import('@/lib/server/domains/export/export-run.service')
  const { NotFoundError } = await import('@/lib/shared/errors')

  try {
    const validation = await validateApiWorkspaceAccess()
    if (!validation.success) {
      return Response.json({ error: validation.error }, { status: validation.status })
    }

    if (!canAccess(validation.principal.role as Role, ['admin'])) {
      return Response.json({ error: 'Only admins can view export runs' }, { status: 403 })
    }

    if (!isValidTypeId(runId, 'export_run')) {
      return Response.json({ error: 'Invalid export run ID format' }, { status: 400 })
    }

    const run = await getExportRun(runId as ExportRunId)
    return Response.json({ run })
  } catch (error) {
    if (error instanceof NotFoundError) {
      return Response.json({ error: error.message }, { status: 404 })
    }
    log.error({ err: error }, 'get export run failed')
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const Route = createFileRoute('/api/export/runs/$runId')({
  server: {
    handlers: {
      GET: ({ params }) => handleGetExportRun(params.runId),
    },
  },
})
