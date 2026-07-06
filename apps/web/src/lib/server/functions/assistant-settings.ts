/**
 * Assistant customization server fns: per-tool execution controls,
 * per-surface instructions, and the Basics tone/length preset. All four gate
 * on assistant.manage — the same permission the AI & Automation settings
 * area gates on.
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import {
  assistantToolControlsSchema,
  assistantSurfacesSchema,
  assistantBasicsSchema,
} from '@/lib/server/domains/settings/settings.assistant'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import { recordAuditEvent, actorFromAuth } from '@/lib/server/audit/log'
import { requireAuth } from './auth-helpers'

const log = logger.child({ component: 'assistant-settings' })

/** All three namespaces in one request — the settings page renders them together. */
export const getAssistantSettingsFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch assistant settings')
  try {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { getAssistantConfig } = await import('@/lib/server/domains/settings/settings.assistant')
    return await getAssistantConfig()
  } catch (error) {
    log.error({ err: error }, 'fetch assistant settings failed')
    throw error
  }
})

export const updateAssistantToolControlsFn = createServerFn({ method: 'POST' })
  .validator(assistantToolControlsSchema)
  .handler(async ({ data }) => {
    log.info('update assistant tool controls')
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
      const { updateAssistantToolControls } =
        await import('@/lib/server/domains/settings/settings.assistant')
      const result = await updateAssistantToolControls(data)
      await recordAuditEvent({
        event: 'assistant.tool_controls.changed',
        actor: actorFromAuth(ctx),
        headers: getRequestHeaders(),
        after: data,
      })
      return result
    } catch (error) {
      log.error({ err: error }, 'update assistant tool controls failed')
      throw error
    }
  })

export const updateAssistantSurfacesFn = createServerFn({ method: 'POST' })
  .validator(assistantSurfacesSchema)
  .handler(async ({ data }) => {
    log.info('update assistant surfaces')
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
      const { updateAssistantSurfaces } =
        await import('@/lib/server/domains/settings/settings.assistant')
      const result = await updateAssistantSurfaces(data)
      await recordAuditEvent({
        event: 'assistant.surfaces.changed',
        actor: actorFromAuth(ctx),
        headers: getRequestHeaders(),
        after: data,
      })
      return result
    } catch (error) {
      log.error({ err: error }, 'update assistant surfaces failed')
      throw error
    }
  })

export const updateAssistantBasicsFn = createServerFn({ method: 'POST' })
  .validator(assistantBasicsSchema)
  .handler(async ({ data }) => {
    log.info('update assistant basics')
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
      const { updateAssistantBasics } =
        await import('@/lib/server/domains/settings/settings.assistant')
      const result = await updateAssistantBasics(data)
      await recordAuditEvent({
        event: 'assistant.basics.changed',
        actor: actorFromAuth(ctx),
        headers: getRequestHeaders(),
        after: data,
      })
      return result
    } catch (error) {
      log.error({ err: error }, 'update assistant basics failed')
      throw error
    }
  })
