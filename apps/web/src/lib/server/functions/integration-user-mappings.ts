/**
 * Server functions for the accounts on a provider matched to teammates
 * (`integration_user_mappings`): list them, match one, remove one. Matching
 * and removing are audited. The provider-specific helpers that find accounts
 * (GitHub's suggestions and login lookup) live with the provider.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type { IntegrationUserMappingId, PrincipalId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { db, integrations, eq } from '@/lib/server/db'
import { recordAuditEvent, actorFromAuth } from '@/lib/server/audit/log'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { NotFoundError } from '@/lib/shared/errors'
import type { IntegrationUserMappingSummary } from '@/lib/server/integrations/user-mappings'

export type { IntegrationUserMappingSummary }

const integrationTypeSchema = z.object({ integrationType: z.string().min(1).max(50) })

const upsertSchema = integrationTypeSchema.extend({
  externalUserId: z.string().trim().min(1).max(64),
  externalLogin: z.string().trim().min(1).max(100),
  externalDisplayName: z.string().trim().max(255).nullable().optional(),
  principalId: z.string().min(1).max(100),
})

const deleteSchema = integrationTypeSchema.extend({ mappingId: z.string().min(1).max(100) })

async function integrationIdOf(integrationType: string) {
  const integration = await db.query.integrations.findFirst({
    where: eq(integrations.integrationType, integrationType),
    columns: { id: true },
  })
  return integration?.id ?? null
}

/** The connection's matched accounts. Empty when the integration is not connected. */
export const listIntegrationUserMappingsFn = createServerFn({ method: 'GET' })
  .validator(integrationTypeSchema)
  .handler(async ({ data }): Promise<IntegrationUserMappingSummary[]> => {
    await requireAuth({ permission: PERMISSIONS.INTEGRATION_VIEW })
    const integrationId = await integrationIdOf(data.integrationType)
    if (!integrationId) return []
    const { listUserMappings } = await import('@/lib/server/integrations/user-mappings')
    return listUserMappings(integrationId)
  })

/** Match an account to a teammate, or move its match to another teammate. Audited. */
export const upsertIntegrationUserMappingFn = createServerFn({ method: 'POST' })
  .validator(upsertSchema)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const ctx = await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })
    const integrationId = await integrationIdOf(data.integrationType)
    if (!integrationId) throw new NotFoundError('INTEGRATION_NOT_FOUND', 'Integration not found')
    const { upsertUserMapping } = await import('@/lib/server/integrations/user-mappings')
    const { mapping, previous } = await upsertUserMapping({
      integrationId,
      externalUserId: data.externalUserId,
      externalLogin: data.externalLogin,
      externalDisplayName: data.externalDisplayName ?? null,
      principalId: data.principalId as PrincipalId,
      createdByPrincipalId: ctx.principal.id,
    })
    await recordAuditEvent({
      event: 'integration.user_mapping.added',
      actor: actorFromAuth(ctx),
      headers: getRequestHeaders(),
      target: { type: 'integration_user_mapping', id: mapping.id },
      before: previous
        ? { externalLogin: previous.externalLogin, principalId: previous.principalId }
        : undefined,
      after: {
        integrationType: data.integrationType,
        externalUserId: mapping.externalUserId,
        externalLogin: mapping.externalLogin,
        principalId: mapping.principalId,
      },
    })
    return { id: mapping.id }
  })

/** Remove a match. Audited. */
export const deleteIntegrationUserMappingFn = createServerFn({ method: 'POST' })
  .validator(deleteSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const ctx = await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })
    const integrationId = await integrationIdOf(data.integrationType)
    if (!integrationId) throw new NotFoundError('INTEGRATION_NOT_FOUND', 'Integration not found')
    const { deleteUserMapping } = await import('@/lib/server/integrations/user-mappings')
    const removed = await deleteUserMapping(
      integrationId,
      data.mappingId as IntegrationUserMappingId
    )
    await recordAuditEvent({
      event: 'integration.user_mapping.removed',
      actor: actorFromAuth(ctx),
      headers: getRequestHeaders(),
      target: { type: 'integration_user_mapping', id: removed.id },
      before: {
        integrationType: data.integrationType,
        externalUserId: removed.externalUserId,
        externalLogin: removed.externalLogin,
        principalId: removed.principalId,
      },
    })
    return { ok: true }
  })
