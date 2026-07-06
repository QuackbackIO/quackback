/**
 * Query-options factory for a live Quinn pending-action row. Both
 * proposed-action cards (the inbox approval card, PendingActionCard, and the
 * Copilot answer card — see `usePendingActionDecision`) fetch this ONCE for
 * the current status instead of trusting the stale note snapshot
 * (metadata.assistantPendingAction) that announced the proposal; there is no
 * polling interval on this query, so updates after that only ever come from
 * a mutation seeding the cache (an approve/reject settling) or an explicit
 * invalidation (a decide error, so a stale "proposed" view refetches the
 * real status instead of staying stale) — never from a background refetch
 * loop. Mirrors how conversation-inbox's `thread` factory is the single
 * source of truth for its query key + fetcher.
 */
import { queryOptions } from '@tanstack/react-query'
import type { AssistantPendingActionId } from '@quackback/ids'
import { getAssistantPendingActionFn } from '@/lib/server/functions/assistant-pending-actions'

export const assistantPendingActionKeys = {
  /** A single pending action's live status. */
  detail: (id: AssistantPendingActionId) => ['admin', 'inbox', 'pending-action', id] as const,
}

export const assistantPendingActionQueries = {
  detail: (id: AssistantPendingActionId) =>
    queryOptions({
      queryKey: assistantPendingActionKeys.detail(id),
      queryFn: () => getAssistantPendingActionFn({ data: { pendingActionId: id } }),
    }),
}
