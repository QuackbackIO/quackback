/**
 * Server functions for post activity log
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PostId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { getActivityForPost } from '@/lib/server/domains/activity/activity.service'

/**
 * Get all activity for a post (admin only).
 */
export const fetchActivityForPost = createServerFn({ method: 'GET' })
  .validator(z.object({ postId: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.POST_VIEW_PRIVATE })
    return getActivityForPost(data.postId as PostId)
  })
