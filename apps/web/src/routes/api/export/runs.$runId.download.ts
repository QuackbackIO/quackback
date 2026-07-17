import { createFileRoute } from '@tanstack/react-router'
import type { Role } from '@/lib/shared/roles'
import type { AuditActorType } from '@/lib/server/audit/log'
import { isValidTypeId } from '@quackback/ids'
import type { ExportRunId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'export-run-download' })

/** Presigned download URLs live 15 minutes — the hub re-requests on demand. */
const DOWNLOAD_URL_TTL_SECONDS = 900

/**
 * GET /api/export/runs/{runId}/download - download the finished workspace
 * export ZIP. Redirects to a short-lived presigned S3 URL (or streams through
 * the server when S3_PROXY is on and the browser can't reach the bucket).
 * Audit-logged like the conversations export: the archive contains personal
 * data, so every download is a recorded, attributable event.
 */
export async function handleDownloadExportRun(runId: string, request: Request): Promise<Response> {
  const { validateApiWorkspaceAccess } = await import('@/lib/server/functions/workspace')
  const { canAccess } = await import('@/lib/server/auth')
  const { getExportRun } = await import('@/lib/server/domains/export/export-run.service')
  const { recordAuditEvent } = await import('@/lib/server/audit/log')
  const { NotFoundError } = await import('@/lib/shared/errors')

  try {
    const validation = await validateApiWorkspaceAccess()
    if (!validation.success) {
      return Response.json({ error: validation.error }, { status: validation.status })
    }

    if (!canAccess(validation.principal.role as Role, ['admin'])) {
      log.warn({ role: validation.principal.role }, 'export download access denied')
      return Response.json({ error: 'Only admins can download exports' }, { status: 403 })
    }

    // Tier gate: data exports are a Pro+ feature (same gate as starting one).
    const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
    const { enforceFeatureGate } = await import('@/lib/server/domains/settings/tier-enforce')
    const limits = await getTierLimits()
    enforceFeatureGate({
      enabled: limits.features.analyticsExports,
      feature: 'analyticsExports',
      friendly: 'Data export',
    })

    if (!isValidTypeId(runId, 'export_run')) {
      return Response.json({ error: 'Invalid export run ID format' }, { status: 400 })
    }

    const run = await getExportRun(runId as ExportRunId)
    if (run.status !== 'completed' || !run.s3Key) {
      return Response.json(
        { error: run.status === 'failed' ? 'This export failed' : 'Export is not ready yet' },
        { status: 409 }
      )
    }
    if (run.expiresAt && run.expiresAt.getTime() < Date.now()) {
      return Response.json({ error: 'This export has expired' }, { status: 410 })
    }

    await recordAuditEvent({
      event: 'export.workspace.downloaded',
      actor: {
        userId: validation.user.id,
        email: validation.user.email,
        role: validation.principal.role,
        type: validation.principal.type as AuditActorType,
      },
      headers: request.headers,
      target: { type: 'export', id: run.id },
      metadata: { sizeBytes: run.sizeBytes },
    })

    const { config } = await import('@/lib/server/config')
    const { getS3Object, generatePresignedGetUrl } = await import('@/lib/server/storage/s3')
    if (config.s3Proxy) {
      // Browser can't reach the bucket — stream bytes through the server.
      const { body } = await getS3Object(run.s3Key)
      return new Response(body, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${run.fileName}"`,
        },
      })
    }

    const url = await generatePresignedGetUrl(run.s3Key, DOWNLOAD_URL_TTL_SECONDS, run.fileName)
    return new Response(null, { status: 302, headers: { Location: url } })
  } catch (error) {
    if (error instanceof NotFoundError) {
      return Response.json({ error: error.message }, { status: 404 })
    }
    const { TierLimitError } = await import('@/lib/server/errors/tier-limit-error')
    if (error instanceof TierLimitError) {
      return Response.json(error.toResponseBody(), { status: error.statusCode })
    }
    log.error({ err: error }, 'export download failed')
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const Route = createFileRoute('/api/export/runs/$runId/download')({
  server: {
    handlers: {
      GET: ({ params, request }) => handleDownloadExportRun(params.runId, request),
    },
  },
})
