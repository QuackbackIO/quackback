/**
 * Audit log server functions — read-only.
 *
 * Writes go through `recordEvent` from inside other domains; this module only
 * exposes the listing endpoint used by the admin audit-log page.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { requirePermission } from './auth-helpers'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { listEvents, listAuditEvents, listDistinctActions } from '@/lib/server/domains/audit'
import {
  listUnifiedAuditActions,
  listUnifiedAuditEvents,
} from '@/lib/server/domains/audit/audit.unified'
import type { PrincipalId } from '@quackback/ids'

export const listAuditEventsFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      principalId: z.string().optional(),
      action: z.string().optional(),
      targetType: z.string().optional(),
      targetId: z.string().optional(),
      sinceIso: z.string().datetime().optional(),
      untilIso: z.string().datetime().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    })
  )
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.AUDIT_VIEW)
    return listEvents({
      principalId: data.principalId as PrincipalId | undefined,
      action: data.action,
      targetType: data.targetType,
      targetId: data.targetId,
      since: data.sinceIso ? new Date(data.sinceIso) : undefined,
      until: data.untilIso ? new Date(data.untilIso) : undefined,
      limit: data.limit,
    })
  })

/**
 * Paginated audit listing with cursor — used by the public REST endpoint.
 */
export const listAuditEventsPagedFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      principalId: z.string().optional(),
      action: z.string().optional(),
      actionPrefix: z.string().optional(),
      targetType: z.string().optional(),
      targetId: z.string().optional(),
      source: z.enum(['web', 'api', 'integration', 'system', 'mcp']).optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    })
  )
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.AUDIT_VIEW)
    return listAuditEvents({
      principalId: data.principalId as PrincipalId | undefined,
      action: data.action,
      actionPrefix: data.actionPrefix,
      targetType: data.targetType,
      targetId: data.targetId,
      source: data.source,
      from: data.from ? new Date(data.from) : undefined,
      to: data.to ? new Date(data.to) : undefined,
      cursor: data.cursor,
      limit: data.limit,
    })
  })

/**
 * Distinct action keys present in the audit log. Used by the admin UI to
 * populate the action combobox.
 */
export const getAuditActionsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requirePermission(PERMISSIONS.AUDIT_VIEW)
  return listDistinctActions()
})

export const listUnifiedAuditEventsFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      origin: z.enum(['workspace', 'security']).optional(),
      principalId: z.string().optional(),
      actorEmail: z.string().max(254).optional(),
      action: z.string().optional(),
      actionPrefix: z.string().optional(),
      targetType: z.string().optional(),
      targetId: z.string().optional(),
      source: z.enum(['web', 'api', 'integration', 'system', 'mcp']).optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      excludeSecurityActions: z.array(z.string()).optional(),
    })
  )
  .handler(async ({ data }) => {
    await requirePermission(PERMISSIONS.AUDIT_VIEW)
    return listUnifiedAuditEvents({
      origin: data.origin,
      principalId: data.principalId as PrincipalId | undefined,
      actorEmail: data.actorEmail,
      action: data.action,
      actionPrefix: data.actionPrefix,
      targetType: data.targetType,
      targetId: data.targetId,
      source: data.source,
      from: data.from ? new Date(data.from) : undefined,
      to: data.to ? new Date(data.to) : undefined,
      cursor: data.cursor,
      limit: data.limit,
      excludeSecurityActions: data.excludeSecurityActions,
    })
  })

export const getUnifiedAuditActionsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requirePermission(PERMISSIONS.AUDIT_VIEW)
  return listUnifiedAuditActions()
})
