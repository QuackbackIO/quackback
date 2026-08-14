import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { requireAuth } from './auth-helpers'
import {
  createConnectorSchema,
  updateConnectorSchema,
  connectorToolRuleUpdateSchema,
} from '@/lib/server/domains/assistant/connectors.service'
import type { AssistantConnectorId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import { recordAuditEvent, actorFromAuth } from '@/lib/server/audit/log'

const log = logger.child({ component: 'assistant-connectors-fn' })

function connectorAuditHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'invalid'
  }
}

export const listConnectorsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
  const { listConnectors } = await import('@/lib/server/domains/assistant/connectors.service')
  return listConnectors()
})

export const createConnectorFn = createServerFn({ method: 'POST' })
  .validator(createConnectorSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    log.info({ name: data.name }, 'create connector')
    const { createConnector } = await import('@/lib/server/domains/assistant/connectors.service')
    const row = await createConnector(data, ctx.principal.id)
    await recordAuditEvent({
      event: 'assistant.connector.created',
      actor: actorFromAuth(ctx),
      headers: getRequestHeaders(),
      target: { type: 'assistant_connector', id: row.id },
      after: {
        name: row.name,
        host: connectorAuditHost(row.url),
        enabled: row.enabled,
        assignments: row.assignments,
        hasAuthToken: row.hasAuthToken,
      },
    })
    return row
  })

export const updateConnectorFn = createServerFn({ method: 'POST' })
  .validator(updateConnectorSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { updateConnector } = await import('@/lib/server/domains/assistant/connectors.service')
    const row = await updateConnector(data)
    await recordAuditEvent({
      event: 'assistant.connector.updated',
      actor: actorFromAuth(ctx),
      headers: getRequestHeaders(),
      target: { type: 'assistant_connector', id: row.id },
      after: {
        name: row.name,
        host: connectorAuditHost(row.url),
        enabled: row.enabled,
        assignments: row.assignments,
        hasAuthToken: row.hasAuthToken,
      },
    })
    return row
  })

export const deleteConnectorFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { deleteConnector } = await import('@/lib/server/domains/assistant/connectors.service')
    await deleteConnector(data.id as AssistantConnectorId)
    await recordAuditEvent({
      event: 'assistant.connector.deleted',
      actor: actorFromAuth(ctx),
      headers: getRequestHeaders(),
      target: { type: 'assistant_connector', id: data.id },
    })
    return { ok: true as const }
  })

export const syncConnectorFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { syncConnectorTools } = await import('@/lib/server/domains/assistant/connectors.service')
    const row = await syncConnectorTools(data.id as AssistantConnectorId)
    await recordAuditEvent({
      event: 'assistant.connector.synced',
      actor: actorFromAuth(ctx),
      headers: getRequestHeaders(),
      target: { type: 'assistant_connector', id: row.id },
      after: { toolCount: row.tools.length, lastSyncError: row.lastSyncError },
    })
    return row
  })

export const updateConnectorToolRuleFn = createServerFn({ method: 'POST' })
  .validator(connectorToolRuleUpdateSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { updateConnectorToolRule } =
      await import('@/lib/server/domains/assistant/connectors.service')
    const row = await updateConnectorToolRule(data)
    await recordAuditEvent({
      event: 'assistant.connector.rule_changed',
      actor: actorFromAuth(ctx),
      headers: getRequestHeaders(),
      target: { type: 'assistant_connector', id: row.id },
      after: { toolName: data.toolName, rule: data.rule },
    })
    return row
  })
