import { createFileRoute } from '@tanstack/react-router'
import type { Role } from '@/lib/shared/roles'
import type { AuditActorType } from '@/lib/server/audit/log'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'export-workspace' })

/** True for the partial-unique-index violation on a second active run. */
function isActiveRunConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === '23505'
  )
}

/**
 * POST /api/export/workspace - start an async workspace data export.
 * Creates the export_runs row and enqueues the ZIP build; the hub polls
 * GET /api/export/runs/{id} and downloads via GET .../download once completed.
 * At most one active run per deployment (409 while one is in flight).
 */
export async function handleStartWorkspaceExport(request: Request): Promise<Response> {
  const { validateApiWorkspaceAccess } = await import('@/lib/server/functions/workspace')
  const { canAccess } = await import('@/lib/server/auth')
  const { findActiveExportRun, createExportRun, failExportRun } =
    await import('@/lib/server/domains/export/export-run.service')
  const { enqueueWorkspaceExportJob } = await import('@/lib/server/domains/export/export-queue')
  const { recordAuditEvent } = await import('@/lib/server/audit/log')

  log.info('workspace export requested')
  try {
    const validation = await validateApiWorkspaceAccess()
    if (!validation.success) {
      return Response.json({ error: validation.error }, { status: validation.status })
    }

    if (!canAccess(validation.principal.role as Role, ['admin'])) {
      log.warn({ role: validation.principal.role }, 'workspace export access denied')
      return Response.json({ error: 'Only admins can export data' }, { status: 403 })
    }

    // Tier gate: data exports are a Pro+ feature (same gate as the CSV exports).
    const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
    const { enforceFeatureGate } = await import('@/lib/server/domains/settings/tier-enforce')
    const limits = await getTierLimits()
    enforceFeatureGate({
      enabled: limits.features.analyticsExports,
      feature: 'analyticsExports',
      friendly: 'Data export',
    })

    const active = await findActiveExportRun()
    if (active) {
      return Response.json(
        { error: 'An export is already running', runId: active.id },
        { status: 409 }
      )
    }

    const slug = validation.settings.slug
    const fileName = `quackback-export-${slug}-${new Date().toISOString().slice(0, 10)}.zip`

    let run
    try {
      run = await createExportRun({
        fileName,
        initiatedByPrincipalId: validation.principal.id,
      })
    } catch (error) {
      // Lost the race with a concurrent request against the unique index.
      if (isActiveRunConflict(error)) {
        return Response.json({ error: 'An export is already running' }, { status: 409 })
      }
      throw error
    }

    try {
      await enqueueWorkspaceExportJob({ runId: run.id, workspaceSlug: slug })
    } catch (error) {
      // No orphan pending row holding the single active slot hostage.
      await failExportRun(run.id, 'Failed to queue the export job')
      throw error
    }

    await recordAuditEvent({
      event: 'export.workspace.requested',
      actor: {
        userId: validation.user.id,
        email: validation.user.email,
        role: validation.principal.role,
        type: validation.principal.type as AuditActorType,
      },
      headers: request.headers,
      target: { type: 'export', id: 'workspace' },
      metadata: { runId: run.id },
    })

    log.info({ run_id: run.id }, 'workspace export queued')
    return Response.json({ runId: run.id }, { status: 202 })
  } catch (error) {
    const { TierLimitError } = await import('@/lib/server/errors/tier-limit-error')
    if (error instanceof TierLimitError) {
      return Response.json(error.toResponseBody(), { status: error.statusCode })
    }
    log.error({ err: error }, 'workspace export request failed')
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const Route = createFileRoute('/api/export/workspace')({
  server: {
    handlers: {
      POST: ({ request }) => handleStartWorkspaceExport(request),
    },
  },
})
