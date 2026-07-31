/**
 * Server functions for saved feedback-inbox views.
 *
 * Listing needs only post.view_private (any teammate who can see the inbox);
 * creating / deleting a view is gated by post.edit (triage capability). Views
 * are workspace-shared; the running of a view (filters → inbox state) happens
 * client-side, so these endpoints only store + serve the definitions.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PostViewId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { postViewFiltersSchema } from '@/lib/shared/post/views'

const createViewSchema = z.object({
  name: z.string().min(1).max(80),
  filters: postViewFiltersSchema,
  isShared: z.boolean().optional(),
})

const viewIdSchema = z.object({ viewId: z.string() })

/** All saved views visible to the caller (shared + own private), alphabetical. */
export const listPostViewsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const ctx = await requireAuth({ permission: PERMISSIONS.POST_VIEW_PRIVATE })
  const { listViewsForPrincipal } =
    await import('@/lib/server/domains/post-views/post-views.service')
  return await listViewsForPrincipal(ctx.principal.id)
})

export const createPostViewFn = createServerFn({ method: 'POST' })
  .validator(createViewSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.POST_EDIT })
    const { createView } = await import('@/lib/server/domains/post-views/post-views.service')
    const id = await createView(
      { name: data.name, filters: data.filters, isShared: data.isShared },
      ctx.principal.id
    )
    return { id }
  })

export const deletePostViewFn = createServerFn({ method: 'POST' })
  .validator(viewIdSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.POST_EDIT })
    const { deleteView } = await import('@/lib/server/domains/post-views/post-views.service')
    await deleteView(data.viewId as PostViewId)
    return { ok: true }
  })
