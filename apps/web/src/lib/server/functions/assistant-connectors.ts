import { createServerFn } from '@tanstack/react-start'
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

const log = logger.child({ component: 'assistant-connectors-fn' })

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
    return createConnector(data, ctx.principal.id)
  })

export const updateConnectorFn = createServerFn({ method: 'POST' })
  .validator(updateConnectorSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { updateConnector } = await import('@/lib/server/domains/assistant/connectors.service')
    return updateConnector(data)
  })

export const deleteConnectorFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { deleteConnector } = await import('@/lib/server/domains/assistant/connectors.service')
    await deleteConnector(data.id as AssistantConnectorId)
    return { ok: true as const }
  })

export const syncConnectorFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { syncConnectorTools } = await import('@/lib/server/domains/assistant/connectors.service')
    return syncConnectorTools(data.id as AssistantConnectorId)
  })

export const updateConnectorToolRuleFn = createServerFn({ method: 'POST' })
  .validator(connectorToolRuleUpdateSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { updateConnectorToolRule } =
      await import('@/lib/server/domains/assistant/connectors.service')
    return updateConnectorToolRule(data)
  })
