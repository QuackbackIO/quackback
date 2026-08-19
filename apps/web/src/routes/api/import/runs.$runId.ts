import { createFileRoute } from '@tanstack/react-router'
import type { Role } from '@/lib/shared/roles'
import { isValidTypeId } from '@quackback/ids'
import type { ImportRunId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'import-run' })

/**
 * GET /api/import/runs/{runId} - poll a single run's status (§I1). The hub
 * page polls this while a run is pending/dry_run/running, then renders the
 * final totals + capped error report once it lands on completed/failed.
 */
export async function handleGetImportRun(runId: string): Promise<Response> {
  const { validateApiWorkspaceAccess } = await import('@/lib/server/functions/workspace')
  const { canAccess } = await import('@/lib/server/auth')
  const { getImportRun } = await import('@/lib/server/domains/import/import-run.service')
  const { NotFoundError } = await import('@/lib/shared/errors')

  try {
    const validation = await validateApiWorkspaceAccess()
    if (!validation.success) {
      return Response.json({ error: validation.error }, { status: validation.status })
    }

    if (!canAccess(validation.principal.role as Role, ['admin'])) {
      return Response.json({ error: 'Only admins can view import runs' }, { status: 403 })
    }

    if (!isValidTypeId(runId, 'import_run')) {
      return Response.json({ error: 'Invalid import run ID format' }, { status: 400 })
    }

    const run = await getImportRun(runId as ImportRunId)
    return Response.json({ run })
  } catch (error) {
    if (error instanceof NotFoundError) {
      return Response.json({ error: error.message }, { status: 404 })
    }
    log.error({ err: error }, 'get import run failed')
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const Route = createFileRoute('/api/import/runs/$runId')({
  server: {
    handlers: {
      GET: ({ params }) => handleGetImportRun(params.runId),
    },
  },
})
