/**
 * Server fns behind the post modal's subscribers list: who follows a post,
 * and a teammate adding or removing someone. The rules live in
 * domains/posts/post.subscribers.ts, which the REST API and the MCP tools
 * share; these gate on the same permissions up front so a caller without
 * them fails before any read.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PostId, PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { toIsoString } from '@/lib/shared/utils'
import { requireAuth, policyActorFromAuth } from './auth-helpers'

const postSubscriberSchema = z.object({ postId: z.string(), principalId: z.string() })

export const listPostSubscribersFn = createServerFn({ method: 'GET' })
  .validator(z.object({ postId: z.string() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.POST_VIEW_PRIVATE })
    const actor = await policyActorFromAuth(ctx)
    const { listPostSubscribers } = await import('@/lib/server/domains/posts/post.subscribers')
    const subscribers = await listPostSubscribers(data.postId as PostId, actor)
    return subscribers.map((s) => ({ ...s, createdAt: toIsoString(s.createdAt) }))
  })

export const addPostSubscriberFn = createServerFn({ method: 'POST' })
  .validator(postSubscriberSchema.extend({ level: z.enum(['all', 'status_only']).optional() }))
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.POST_VOTE_ON_BEHALF })
    const actor = await policyActorFromAuth(ctx)
    const { addPostSubscriber } = await import('@/lib/server/domains/posts/post.subscribers')
    return addPostSubscriber(data.postId as PostId, data.principalId as PrincipalId, actor, {
      level: data.level,
    })
  })

export const removePostSubscriberFn = createServerFn({ method: 'POST' })
  .validator(postSubscriberSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth({ permission: PERMISSIONS.POST_VOTE_ON_BEHALF })
    const actor = await policyActorFromAuth(ctx)
    const { removePostSubscriber } = await import('@/lib/server/domains/posts/post.subscribers')
    return removePostSubscriber(data.postId as PostId, data.principalId as PrincipalId, actor)
  })
