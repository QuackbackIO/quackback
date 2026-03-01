/**
 * Merge suggestion hook handler.
 *
 * Fires on post.created events to check for duplicate posts.
 * The embedding may not be ready yet (the AI hook runs concurrently),
 * so the handler checks for embedding existence and skips if missing —
 * the periodic sweep catches it within 30 minutes.
 */

import type { HookHandler, HookResult } from '../hook-types'
import type { EventData } from '../types'
import type { PostId } from '@quackback/ids'

export const mergeSuggestionHook: HookHandler = {
  async run(
    event: EventData,
    _target: unknown,
    _config: Record<string, unknown>
  ): Promise<HookResult> {
    const postId = (event.data as { post: { id: string } }).post.id as PostId

    try {
      const { checkPostForMergeCandidates } = await import('@/lib/server/domains/merge-suggestions')
      await checkPostForMergeCandidates(postId)
    } catch (err) {
      console.error(`[MergeSuggestion] Hook failed for post ${postId}:`, err)
    }

    return { success: true }
  },
}
