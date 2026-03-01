/**
 * Summary hook handler.
 *
 * Generates AI post summaries on post.created and comment.created events.
 * Non-critical: errors are logged but never block event processing.
 */

import type { HookHandler, HookResult } from '../hook-types'
import type { EventData } from '../types'
import { generateAndSavePostSummary } from '@/lib/server/domains/summary'
import type { PostId } from '@quackback/ids'

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
      console.error(`[Summary] Hook failed for post ${postId}:`, err)
    }

    return { success: true }
  },
}
