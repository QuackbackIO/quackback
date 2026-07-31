/**
 * Web-source CRUD server fns for the assistant knowledge settings. Gates on
 * assistant.manage, same as snippets (assistant-snippets.ts) and guidance
 * rules (assistant-guidance.ts). Adding a source crawls the URL at write
 * time through the SSRF-guarded fetch (web-source.service.ts). The admin UI
 * card that calls these is deferred — this is the server-side CRUD
 * foundation only.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { AssistantWebSourceId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import { requireAuth } from './auth-helpers'

const log = logger.child({ component: 'assistant-web-sources' })

const addWebSourceSchema = z.object({
  url: z.url().max(2048),
})

const webSourceIdSchema = z.object({ id: z.string() })

const setWebSourceEnabledSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
})

/** All web sources, enabled or not — the admin list shows every source. */
export const listWebSourcesFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('list web sources')
  await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
  const { listWebSources } = await import('@/lib/server/domains/assistant/web-source.service')
  return listWebSources()
})

export const addWebSourceFn = createServerFn({ method: 'POST' })
  .validator(addWebSourceSchema)
  .handler(async ({ data }) => {
    log.info('add web source')
    const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { addWebSourceFromUrl } =
      await import('@/lib/server/domains/assistant/web-source.service')
    return addWebSourceFromUrl({ url: data.url, createdById: ctx.principal.id })
  })

export const setWebSourceEnabledFn = createServerFn({ method: 'POST' })
  .validator(setWebSourceEnabledSchema)
  .handler(async ({ data }) => {
    log.info('toggle web source')
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { setWebSourceEnabled } =
      await import('@/lib/server/domains/assistant/web-source.service')
    return setWebSourceEnabled(data.id as AssistantWebSourceId, data.enabled)
  })

export const deleteWebSourceFn = createServerFn({ method: 'POST' })
  .validator(webSourceIdSchema)
  .handler(async ({ data }) => {
    log.info('delete web source')
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { deleteWebSource } = await import('@/lib/server/domains/assistant/web-source.service')
    await deleteWebSource(data.id as AssistantWebSourceId)
    return { id: data.id }
  })
