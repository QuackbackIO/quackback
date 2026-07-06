/**
 * Server functions for the Data Connector v0 admin UI: CRUD plus the
 * test-call flow. Gated on connector.manage + the dataConnectors flag.
 *
 * No tier gate: TierFeatureFlags (settings/tier-limits.types.ts) has no entry
 * for data connectors yet, and the assistant-actions precedent (also
 * flag-only, no tier gate) is the nearest analog — add one here when a plan
 * boundary for connectors is actually decided.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import { recordAuditEvent, actorFromAuth } from '@/lib/server/audit/log'
import type { DataConnectorId } from '@quackback/ids'

const log = logger.child({ component: 'data-connectors-fn' })

const connectorHeaderSchema = z.object({
  name: z.string().min(1).max(200),
  value: z.string().max(2000),
})

const connectorAuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('bearer') }),
  z.object({ type: z.literal('header'), headerName: z.string().min(1).max(200) }),
  z.object({ type: z.literal('basic') }),
])

const connectorInputFieldSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['string', 'number', 'boolean']),
  description: z.string().max(500).optional(),
  required: z.boolean().optional(),
})

const createConnectorSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  method: z.enum(['GET', 'POST']),
  urlTemplate: z.string().min(1).max(2000),
  headers: z.array(connectorHeaderSchema).max(20).optional(),
  auth: connectorAuthSchema.optional(),
  secret: z.string().min(1).max(4000).optional(),
  inputs: z.array(connectorInputFieldSchema).max(20).optional(),
  bodyTemplate: z.string().max(10000).optional(),
  timeoutMs: z.number().int().positive().max(30000).optional(),
  enabled: z.boolean().optional(),
})

const updateConnectorSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(2000).optional(),
  method: z.enum(['GET', 'POST']).optional(),
  urlTemplate: z.string().min(1).max(2000).optional(),
  headers: z.array(connectorHeaderSchema).max(20).optional(),
  auth: connectorAuthSchema.optional(),
  secret: z.string().min(1).max(4000).optional(),
  clearSecret: z.boolean().optional(),
  inputs: z.array(connectorInputFieldSchema).max(20).optional(),
  bodyTemplate: z.string().max(10000).nullable().optional(),
  timeoutMs: z.number().int().positive().max(30000).optional(),
  enabled: z.boolean().optional(),
  status: z.enum(['active', 'disabled']).optional(),
})

const connectorIdSchema = z.object({ id: z.string() })

const testConnectorSchema = z.object({
  id: z.string(),
  sampleValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
})

/** The feature-flag half of the gate every handler below repeats inline
 *  (rather than behind a requireAuth-wrapping helper) so the authz-matrix
 *  scanner — a syntactic check for a direct `requireAuth` call per entry
 *  point — sees each handler as gated. */
async function assertDataConnectorsEnabled(): Promise<void> {
  const { isFeatureEnabled } = await import('@/lib/server/domains/settings/settings.service')
  if (!(await isFeatureEnabled('dataConnectors'))) {
    throw new Error('Data connectors are not enabled')
  }
}

export const fetchDataConnectorsFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    await requireAuth({ permission: PERMISSIONS.CONNECTOR_MANAGE })
    await assertDataConnectorsEnabled()
    const { listConnectors } = await import('@/lib/server/domains/connectors/connector.service')
    return { connectors: await listConnectors() }
  } catch (error) {
    log.error({ err: error }, 'fetch data connectors failed')
    throw error
  }
})

export const fetchDataConnectorFn = createServerFn({ method: 'GET' })
  .validator(connectorIdSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ permission: PERMISSIONS.CONNECTOR_MANAGE })
      await assertDataConnectorsEnabled()
      const { getConnector } = await import('@/lib/server/domains/connectors/connector.service')
      return await getConnector(data.id as DataConnectorId)
    } catch (error) {
      log.error({ err: error }, 'fetch data connector failed')
      throw error
    }
  })

export const createDataConnectorFn = createServerFn({ method: 'POST' })
  .validator(createConnectorSchema)
  .handler(async ({ data }) => {
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.CONNECTOR_MANAGE })
      await assertDataConnectorsEnabled()
      const { createConnector, toAuditSafeConnector } =
        await import('@/lib/server/domains/connectors/connector.service')
      const connector = await createConnector(data, auth.principal.id)
      log.info({ connector_id: connector.id }, 'data connector created')
      await recordAuditEvent({
        event: 'assistant.connector.created',
        actor: actorFromAuth(auth),
        headers: getRequestHeaders(),
        target: { type: 'data_connector', id: connector.id },
        after: toAuditSafeConnector(connector),
      })
      return connector
    } catch (error) {
      log.error({ err: error }, 'create data connector failed')
      throw error
    }
  })

export const updateDataConnectorFn = createServerFn({ method: 'POST' })
  .validator(updateConnectorSchema)
  .handler(async ({ data }) => {
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.CONNECTOR_MANAGE })
      await assertDataConnectorsEnabled()
      const { updateConnector, toAuditSafeConnector } =
        await import('@/lib/server/domains/connectors/connector.service')
      const { id, ...input } = data
      const connector = await updateConnector(id as DataConnectorId, input)
      log.info({ connector_id: connector.id }, 'data connector updated')
      await recordAuditEvent({
        event: 'assistant.connector.updated',
        actor: actorFromAuth(auth),
        headers: getRequestHeaders(),
        target: { type: 'data_connector', id: connector.id },
        after: toAuditSafeConnector(connector),
      })
      return connector
    } catch (error) {
      log.error({ err: error }, 'update data connector failed')
      throw error
    }
  })

export const deleteDataConnectorFn = createServerFn({ method: 'POST' })
  .validator(connectorIdSchema)
  .handler(async ({ data }) => {
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.CONNECTOR_MANAGE })
      await assertDataConnectorsEnabled()
      const { deleteConnector } = await import('@/lib/server/domains/connectors/connector.service')
      await deleteConnector(data.id as DataConnectorId)
      log.info({ connector_id: data.id }, 'data connector deleted')
      await recordAuditEvent({
        event: 'assistant.connector.deleted',
        actor: actorFromAuth(auth),
        headers: getRequestHeaders(),
        target: { type: 'data_connector', id: data.id },
      })
      return { id: data.id as DataConnectorId }
    } catch (error) {
      log.error({ err: error }, 'delete data connector failed')
      throw error
    }
  })

/** Run a live test call and persist the sample response, for the admin
 *  "Test connector" action. */
export const testDataConnectorFn = createServerFn({ method: 'POST' })
  .validator(testConnectorSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth({ permission: PERMISSIONS.CONNECTOR_MANAGE })
      await assertDataConnectorsEnabled()
      const { testConnector } = await import('@/lib/server/domains/connectors/connector.execute')
      return await testConnector(data.id as DataConnectorId, data.sampleValues ?? {})
    } catch (error) {
      log.error({ err: error }, 'test data connector failed')
      throw error
    }
  })
