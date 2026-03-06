/**
 * Server functions for post activity log
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PostId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { getActivityForPost } from '@/lib/server/domains/activity/activity.service'

/**
 * Get all activity for a post (admin only).
 */
export const fetchActivityForPost = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ postId: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })
    return getActivityForPost(data.postId as PostId)
  })
