/**
 * Snippet CRUD server fns for the assistant customization settings UI. Gates
 * on assistant.manage, same as guidance rules (assistant-guidance.ts) and
 * assistant-settings.ts. The admin UI card that calls these, and wiring
 * assistant.snippet.* events into the AI-config audit changelog (the way
 * assistant.guidance.* events already are), are both deferred — this is the
 * server-side CRUD foundation only.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { AssistantSnippetId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import { requireAuth } from './auth-helpers'

const log = logger.child({ component: 'assistant-snippets' })

const audienceSchema = z.enum(['public', 'team', 'internal'])

const createSnippetSchema = z.object({
  title: z.string().min(1).max(120),
  content: z.string().min(1).max(2000),
  audience: audienceSchema.optional(),
  enabled: z.boolean().optional(),
})

const updateSnippetSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(120).optional(),
  content: z.string().min(1).max(2000).optional(),
  audience: audienceSchema.optional(),
  enabled: z.boolean().optional(),
})

const deleteSnippetSchema = z.object({ id: z.string() })

/** All snippets, enabled or not — the admin list shows every snippet. */
export const listSnippetsFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('list snippets')
  try {
    await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
    const { listSnippets } = await import('@/lib/server/domains/assistant/snippet.service')
    return listSnippets()
  } catch (error) {
    log.error({ err: error }, 'list snippets failed')
    throw error
  }
})

export const createSnippetFn = createServerFn({ method: 'POST' })
  .validator(createSnippetSchema)
  .handler(async ({ data }) => {
    log.info('create snippet')
    try {
      const ctx = await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
      const { createSnippet } = await import('@/lib/server/domains/assistant/snippet.service')
      return createSnippet({
        title: data.title,
        content: data.content,
        audience: data.audience,
        enabled: data.enabled,
        createdById: ctx.principal.id,
      })
    } catch (error) {
      log.error({ err: error }, 'create snippet failed')
      throw error
    }
  })

export const updateSnippetFn = createServerFn({ method: 'POST' })
  .validator(updateSnippetSchema)
  .handler(async ({ data }) => {
    log.info('update snippet')
    try {
      await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
      const { updateSnippet } = await import('@/lib/server/domains/assistant/snippet.service')
      return updateSnippet(data.id as AssistantSnippetId, {
        title: data.title,
        content: data.content,
        audience: data.audience,
        enabled: data.enabled,
      })
    } catch (error) {
      log.error({ err: error }, 'update snippet failed')
      throw error
    }
  })

export const deleteSnippetFn = createServerFn({ method: 'POST' })
  .validator(deleteSnippetSchema)
  .handler(async ({ data }) => {
    log.info('delete snippet')
    try {
      await requireAuth({ permission: PERMISSIONS.ASSISTANT_MANAGE })
      const { deleteSnippet } = await import('@/lib/server/domains/assistant/snippet.service')
      await deleteSnippet(data.id as AssistantSnippetId)
      return { id: data.id }
    } catch (error) {
      log.error({ err: error }, 'delete snippet failed')
      throw error
    }
  })
