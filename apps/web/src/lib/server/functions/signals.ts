/**
 * Server functions for AI signals
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PostId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import {
  getSignalSummary,
  getSignalCountsForPosts,
  getSignalsForPost,
} from '@/lib/server/domains/signals'

/**
 * Get pending signal counts by type (for the signal summary bar).
 */
export const fetchSignalSummary = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['admin', 'member'] })
  return getSignalSummary()
})

/**
 * Get signal counts for a batch of post IDs (for L1 badges).
 */
export const fetchSignalCountsForPosts = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ postIds: z.array(z.string()) }))
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })
    return getSignalCountsForPosts(data.postIds as PostId[])
  })

/**
 * Get all pending signals for a single post (for L3 detail panel).
 */
export const fetchSignalsForPost = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ postId: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })
    return getSignalsForPost(data.postId as PostId)
  })
