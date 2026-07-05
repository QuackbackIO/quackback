import { createFileRoute } from '@tanstack/react-router'
import type { Role } from '@/lib/shared/roles'
import type { AuditActorType } from '@/lib/server/audit/log'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'export-conversations' })

/**
 * GET /api/export/conversations - full-content conversation/ticket export
 * as NDJSON (§I3). Admin-only and audit-logged: unlike posts/users, this
 * includes internal notes and full message content, so every download is a
 * recorded, attributable event.
 */
export async function handleExportConversations(request: Request): Promise<Response> {
  const { validateApiWorkspaceAccess } = await import('@/lib/server/functions/workspace')
  const { canAccess } = await import('@/lib/server/auth')
  const { listConversationsForExport } = await import(
    '@/lib/server/domains/conversation/conversation.export'
  )
  const { recordAuditEvent } = await import('@/lib/server/audit/log')

  log.info('conversations export started')
  try {
    const validation = await validateApiWorkspaceAccess()
    if (!validation.success) {
      return Response.json({ error: validation.error }, { status: validation.status })
    }

    if (!canAccess(validation.principal.role as Role, ['admin'])) {
      log.warn({ role: validation.principal.role }, 'conversations export access denied')
      return Response.json({ error: 'Only admins can export conversations' }, { status: 403 })
    }

    // Tier gate: data exports are a Pro+ feature (same gate as posts/users/companies).
    const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
    const { enforceFeatureGate } = await import('@/lib/server/domains/settings/tier-enforce')
    const limits = await getTierLimits()
    enforceFeatureGate({
      enabled: limits.features.analyticsExports,
      feature: 'analyticsExports',
      friendly: 'Data export',
    })

    const rows = await listConversationsForExport()
    const ndjson = rows.map((row) => JSON.stringify(row)).join('\n')
    const filename = `conversations-export-${validation.settings.slug}-${Date.now()}.jsonl`

    await recordAuditEvent({
      event: 'export.conversations.downloaded',
      actor: {
        userId: validation.user.id,
        email: validation.user.email,
        role: validation.principal.role,
        type: validation.principal.type as AuditActorType,
      },
      headers: request.headers,
      target: { type: 'export', id: 'conversations' },
      metadata: { count: rows.length },
    })

    log.info({ conversation_count: rows.length }, 'conversations export complete')
    return new Response(ndjson, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    const { TierLimitError } = await import('@/lib/server/errors/tier-limit-error')
    if (error instanceof TierLimitError) {
      return Response.json(error.toResponseBody(), { status: error.statusCode })
    }
    log.error({ err: error }, 'conversations export failed')
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const Route = createFileRoute('/api/export/conversations')({
  server: {
    handlers: {
      GET: ({ request }) => handleExportConversations(request),
    },
  },
})
