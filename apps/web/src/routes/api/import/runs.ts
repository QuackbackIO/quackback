import { createFileRoute } from '@tanstack/react-router'
import type { Role } from '@/lib/shared/roles'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'import-runs' })

/**
 * GET /api/import/runs - import history for the hub page (§I1).
 * Newest first, capped list; the hub polls the in-flight run(s) by id via
 * GET /api/import/runs/{id} rather than re-listing.
 */
export async function handleListImportRuns(): Promise<Response> {
  const { validateApiWorkspaceAccess } = await import('@/lib/server/functions/workspace')
  const { canAccess } = await import('@/lib/server/auth')
  const { listImportRuns } = await import('@/lib/server/domains/import/import-run.service')

  try {
    const validation = await validateApiWorkspaceAccess()
    if (!validation.success) {
      return Response.json({ error: validation.error }, { status: validation.status })
    }

    if (!canAccess(validation.principal.role as Role, ['admin'])) {
      return Response.json({ error: 'Only admins can view import history' }, { status: 403 })
    }

    const runs = await listImportRuns()
    return Response.json({ runs })
  } catch (error) {
    log.error({ err: error }, 'list import runs failed')
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const Route = createFileRoute('/api/import/runs')({
  server: {
    handlers: {
      GET: () => handleListImportRuns(),
    },
  },
})
