/**
 * Agent Connectors CRUD + refresh. All gate on assistant.manage. Secrets never
 * return to the client.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type { ConnectorId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  connectorCreateInputSchema,
  connectorUpdateInputSchema,
  type BuiltinConnectorDTO,
} from '@/lib/shared/assistant/connectors'
import { logger } from '@/lib/server/logger'
import { recordAuditEvent, actorFromAuth } from '@/lib/server/audit/log'
import { requireAuth } from './auth-helpers'

const log = logger.child({ component: 'assistant-connectors' })

async function loadBuiltinConnector(): Promise<BuiltinConnectorDTO> {
  const { resolveToolSpecs } = await import('@/lib/server/domains/assistant/assistant.toolspec')
  const specs = await resolveToolSpecs()
  return {
    id: 'quackback',
    name: 'Quackback',
    builtin: true,
    tools: specs
      .filter((spec) => spec.risk !== 'control')
      .map((spec) => ({
        name: spec.name,
        label: spec.label,
        description: spec.description,
        group: spec.risk === 'write' ? 'write' : 'read',
      })),
  }
}

const idSchema = z.object({ id: z.string().min(1) })

export const listConnectorsFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('list connectors')
  await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })

  const { listConnectors, toConnectorDTO } =
    await import('@/lib/server/domains/assistant/connectors/connectors.service')
  const builtin = await loadBuiltinConnector()
  const rows = await listConnectors()
  return { builtin, connectors: rows.map(toConnectorDTO) }
})

export const getConnectorFn = createServerFn({ method: 'GET' })
  .validator(idSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    if (data.id === 'quackback') {
      return { builtin: await loadBuiltinConnector(), connector: null }
    }
    const { getConnector, toConnectorDTO } =
      await import('@/lib/server/domains/assistant/connectors/connectors.service')
    const row = await getConnector(data.id as ConnectorId)
    return { builtin: null, connector: row ? toConnectorDTO(row) : null }
  })

export const createConnectorFn = createServerFn({ method: 'POST' })
  .validator(connectorCreateInputSchema)
  .handler(async ({ data }) => {
    log.info('create connector')
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { createConnector, toConnectorDTO, ConnectorOAuthRequiredError } =
      await import('@/lib/server/domains/assistant/connectors/connectors.service')
    const audit = async (id: string, after: Record<string, unknown>) => {
      await recordAuditEvent({
        event: 'assistant.connector.created',
        actor: actorFromAuth(ctx),
        headers: getRequestHeaders(),
        target: { type: 'connector', id },
        after,
      })
    }
    try {
      const row = await createConnector({ ...data, createdByPrincipalId: ctx.principal.id })
      await audit(row.id, { name: row.name, url: row.url, authMode: row.authMode })
      return toConnectorDTO(row)
    } catch (err) {
      if (!(err instanceof ConnectorOAuthRequiredError)) throw err
      const row = err.row
      await audit(row.id, { name: row.name, url: row.url, authMode: row.authMode })
      const { startConnectorOAuth } =
        await import('@/lib/server/domains/assistant/connectors/oauth-provider')
      const headers = getRequestHeaders()
      const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost'
      const proto = headers.get('x-forwarded-proto') ?? 'https'
      const request = new Request(`${proto}://${host}/oauth/connector/callback`, { headers })
      const { authorizationUrl } = await startConnectorOAuth(row.id, request)
      return { ...toConnectorDTO(row), authorizationUrl }
    }
  })

export const updateConnectorFn = createServerFn({ method: 'POST' })
  .validator(connectorUpdateInputSchema)
  .handler(async ({ data }) => {
    log.info('update connector')
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { updateConnector, toConnectorDTO } =
      await import('@/lib/server/domains/assistant/connectors/connectors.service')
    const { id, ...input } = data
    const row = await updateConnector(id as ConnectorId, input)
    await recordAuditEvent({
      event: 'assistant.connector.updated',
      actor: actorFromAuth(ctx),
      headers: getRequestHeaders(),
      target: { type: 'connector', id },
      after: row ? { name: row.name, enabled: row.enabled, assignments: row.assignments } : null,
    })
    return row ? toConnectorDTO(row) : null
  })

export const refreshConnectorFn = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }) => {
    log.info('refresh connector')
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { toConnectorDTO } =
      await import('@/lib/server/domains/assistant/connectors/connectors.service')
    const { refreshConnector } =
      await import('@/lib/server/domains/assistant/connectors/connectors.health')
    const row = await refreshConnector(data.id as ConnectorId)
    await recordAuditEvent({
      event: 'assistant.connector.refreshed',
      actor: actorFromAuth(ctx),
      headers: getRequestHeaders(),
      target: { type: 'connector', id: data.id },
    })
    return row ? toConnectorDTO(row) : null
  })

export const startConnectorOAuthFn = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }) => {
    log.info('start connector oauth')
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { startConnectorOAuth } =
      await import('@/lib/server/domains/assistant/connectors/oauth-provider')
    const headers = getRequestHeaders()
    const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost'
    const proto = headers.get('x-forwarded-proto') ?? 'https'
    const request = new Request(`${proto}://${host}/oauth/connector/callback`, { headers })
    return startConnectorOAuth(data.id as ConnectorId, request)
  })

export const deleteConnectorFn = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }) => {
    log.info('delete connector')
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { deleteConnector } =
      await import('@/lib/server/domains/assistant/connectors/connectors.health')
    await deleteConnector(data.id as ConnectorId)
    await recordAuditEvent({
      event: 'assistant.connector.deleted',
      actor: actorFromAuth(ctx),
      headers: getRequestHeaders(),
      target: { type: 'connector', id: data.id },
    })
    return { id: data.id }
  })
