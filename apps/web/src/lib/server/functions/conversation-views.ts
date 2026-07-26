/**
 * Server functions for custom saved inbox views (support platform §4.6).
 *
 * Listing + pinning need only conversation.view (any teammate who can see the
 * inbox manages their own pins); creating / editing / deleting a shared view is
 * gated by conversation.manage_views. Views are workspace-shared; the running of
 * a view (rules → list filter) happens client-side, so these endpoints only
 * store + serve the definitions.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { ConversationViewId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { withErrorLog } from './with-error-log'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import { conversationViewFiltersSchema, CONVERSATION_SORTS } from '@/lib/shared/conversation/views'

const log = logger.child({ component: 'conversation-views' })

const sortSchema = z.enum(CONVERSATION_SORTS)

const createViewSchema = z.object({
  name: z.string().min(1).max(80),
  filters: conversationViewFiltersSchema,
  sort: sortSchema.nullish(),
  isShared: z.boolean().optional(),
})

const updateViewSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1).max(80).optional(),
    filters: conversationViewFiltersSchema.optional(),
    sort: sortSchema.nullish(),
    isShared: z.boolean().optional(),
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.filters !== undefined ||
      d.sort !== undefined ||
      d.isShared !== undefined,
    { message: 'Provide at least one field to update' }
  )

const viewIdSchema = z.object({ viewId: z.string() })

/** All shared saved views with the caller's pin state (pinned-first). */
export const listConversationViewsFn = createServerFn({ method: 'GET' }).handler(async () => {
  return withErrorLog(log, 'list conversation views', async () => {
    const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
    const { listViewsForPrincipal } =
      await import('@/lib/server/domains/conversation-views/conversation-views.service')
    return await listViewsForPrincipal(ctx.principal.id)
  })
})

export const createConversationViewFn = createServerFn({ method: 'POST' })
  .validator(createViewSchema)
  .handler(async ({ data }) => {
    return withErrorLog(log, 'create conversation view', async () => {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE_VIEWS })
      const { createView } =
        await import('@/lib/server/domains/conversation-views/conversation-views.service')
      const id = await createView(
        {
          name: data.name,
          filters: data.filters,
          sort: data.sort ?? null,
          isShared: data.isShared,
        },
        ctx.principal.id
      )
      return { id }
    })
  })

export const updateConversationViewFn = createServerFn({ method: 'POST' })
  .validator(updateViewSchema)
  .handler(async ({ data }) => {
    return withErrorLog(log, 'update conversation view', async () => {
      await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE_VIEWS })
      const { updateView } =
        await import('@/lib/server/domains/conversation-views/conversation-views.service')
      await updateView(data.id as ConversationViewId, {
        name: data.name,
        filters: data.filters,
        // `null` clears the sort back to the default; `undefined` leaves it.
        sort: data.sort === undefined ? undefined : data.sort,
        isShared: data.isShared,
      })
      return { ok: true }
    })
  })

export const deleteConversationViewFn = createServerFn({ method: 'POST' })
  .validator(viewIdSchema)
  .handler(async ({ data }) => {
    return withErrorLog(log, 'delete conversation view', async () => {
      await requireAuth({ permission: PERMISSIONS.CONVERSATION_MANAGE_VIEWS })
      const { deleteView } =
        await import('@/lib/server/domains/conversation-views/conversation-views.service')
      await deleteView(data.viewId as ConversationViewId)
      return { ok: true }
    })
  })

/** Pin a view for the caller (personal; any inbox viewer may pin). */
export const pinConversationViewFn = createServerFn({ method: 'POST' })
  .validator(viewIdSchema)
  .handler(async ({ data }) => {
    return withErrorLog(log, 'pin conversation view', async () => {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
      const { pinView } =
        await import('@/lib/server/domains/conversation-views/conversation-views.service')
      await pinView(ctx.principal.id, data.viewId as ConversationViewId)
      return { ok: true }
    })
  })

export const unpinConversationViewFn = createServerFn({ method: 'POST' })
  .validator(viewIdSchema)
  .handler(async ({ data }) => {
    return withErrorLog(log, 'unpin conversation view', async () => {
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
      const { unpinView } =
        await import('@/lib/server/domains/conversation-views/conversation-views.service')
      await unpinView(ctx.principal.id, data.viewId as ConversationViewId)
      return { ok: true }
    })
  })
