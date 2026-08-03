/**
 * Webhook delivery queries — cursor-paged delivery feed for the inspector
 * drawer. Backend cursor shape is `{cursorAttemptedAt, cursorId}` (or null).
 */
import { infiniteQueryOptions } from '@tanstack/react-query'
import type { WebhookId } from '@quackback/ids'
import { listWebhookDeliveriesFn } from '@/lib/server/functions/webhook-deliveries'

export type WebhookDeliveryStatusFilter =
  | 'queued'
  | 'success'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'blocked_ssrf'

interface ListFilters {
  status?: WebhookDeliveryStatusFilter
}

interface CursorParam {
  cursorAttemptedAt: string
  cursorId: string
}

const STALE = 15_000

export const webhookDeliveryQueries = {
  all: ['webhook-deliveries'] as const,
  list: (webhookId: WebhookId, filters: ListFilters = {}) =>
    infiniteQueryOptions({
      queryKey: ['webhook-deliveries', 'list', webhookId, filters] as const,
      queryFn: ({ pageParam }) => {
        const cursor = pageParam as CursorParam | undefined
        return listWebhookDeliveriesFn({
          data: {
            webhookId,
            limit: 50,
            status: filters.status,
            cursorAttemptedAt: cursor?.cursorAttemptedAt,
            cursorId: cursor?.cursorId,
          },
        })
      },
      initialPageParam: undefined as CursorParam | undefined,
      getNextPageParam: (last) => (last.nextCursor as CursorParam | null) ?? undefined,
      staleTime: STALE,
    }),
}
