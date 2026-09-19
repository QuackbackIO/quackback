/**
 * Query-options factory for a live Quinn pending-action row. Both
 * proposed-action cards (the inbox approval card, PendingActionCard, and the
 * Copilot answer card — see `usePendingActionDecision`) fetch this ONCE for
 * the current status instead of trusting the stale note snapshot
 * (metadata.assistantPendingAction) that announced the proposal.
 *
 * It polls only while an execution is actually in flight. Approving commits a
 * decision and a job, not an effect, so the row moves again a second or two
 * later when the worker settles it; without that the card would sit on Queued
 * until something unrelated invalidated it, which is exactly the state a
 * reviewer must be able to watch leave. Everything else still arrives the way
 * it did: a mutation seeding the cache, or an explicit invalidation on a
 * decide error. Mirrors how conversation-inbox's `thread` factory is the
 * single source of truth for its query key + fetcher.
 */
import { queryOptions } from '@tanstack/react-query'
import type { AssistantPendingActionId } from '@quackback/ids'
import {
  getAssistantPendingActionFn,
  listAssistantReviewQueueFn,
} from '@/lib/server/functions/assistant-pending-actions'

export const assistantPendingActionKeys = {
  /** A single pending action's live status. */
  detail: (id: AssistantPendingActionId) => ['admin', 'inbox', 'pending-action', id] as const,
  /** The Needs approval queue: proposals to decide and executions to confirm. */
  reviewQueue: () => ['admin', 'inbox', 'assistant-review-queue'] as const,
}

export const assistantPendingActionQueries = {
  detail: (id: AssistantPendingActionId) =>
    queryOptions({
      queryKey: assistantPendingActionKeys.detail(id),
      queryFn: () => getAssistantPendingActionFn({ data: { pendingActionId: id } }),
      // Approving no longer executes inside the request: it queues a worker,
      // and the execution settles seconds later. The card would otherwise sit
      // on "Queued" until something else happened to invalidate it, which is
      // the one state the customer and the reviewer both need to see move.
      // Polling stops as soon as nothing is in flight.
      refetchInterval: (query) => {
        const state = query.state.data?.executionState
        return state === 'queued' || state === 'running' ? 2_000 : false
      },
    }),
  reviewQueue: () =>
    queryOptions({
      queryKey: assistantPendingActionKeys.reviewQueue(),
      queryFn: () => listAssistantReviewQueueFn(),
      staleTime: 15_000,
    }),
}
