import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'

export const getQuinnReviewQueueFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      kind: z.enum(['review', 'live']),
      days: z.union([z.literal(7), z.literal(30)]),
      limit: z.number().int().min(1).max(20).default(10),
    })
  )
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
    const { getQuinnReviewQueue } = await import('@/lib/server/domains/assistant/review-queue')
    return getQuinnReviewQueue(await policyActorFromAuth(auth), data.kind, data.days, data.limit)
  })
