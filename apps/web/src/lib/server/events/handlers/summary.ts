/**
 * Summary hook handler.
 *
 * Generates AI post summaries on post.created and comment.created events.
 * Non-critical: errors are logged but never block event processing.
 */

import type { HookHandler, HookResult } from '../hook-types'
import type { EventData } from '../types'
import { generateAndSavePostSummary } from '@/lib/server/domains/summary/summary.service'
import type { PostId } from '@quackback/ids'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'summary' })

export const summaryHook: HookHandler = {
  async run(
    event: EventData,
    _target: unknown,
    _config: Record<string, unknown>
  ): Promise<HookResult> {
    const postId = (event.data as { post: { id: string } }).post.id as PostId

    try {
      await generateAndSavePostSummary(postId)
    } catch (err) {
      if (err instanceof TierLimitError) {
        log.info({ err, post_id: postId }, 'summary skipped: ai not available on plan')
      } else {
        log.error({ err, post_id: postId }, 'summary hook failed')
      }
    }

    return { success: true }
  },
}
