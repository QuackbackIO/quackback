/**
 * Webhook deliveries query hook (admin-only inspector).
 */
import { useInfiniteQuery } from '@tanstack/react-query'
import type { WebhookId } from '@quackback/ids'
import { listWebhookDeliveriesFn } from '@/lib/server/functions/webhook-deliveries'

type DeliveryStatus = 'queued' | 'success' | 'failed_retryable' | 'failed_terminal' | 'blocked_ssrf'

export const webhookDeliveriesKeys = {
  all: ['webhookDeliveries'] as const,
  list: (webhookId: WebhookId, status?: DeliveryStatus) =>
    [...webhookDeliveriesKeys.all, webhookId, status ?? 'all'] as const,
}

export function useWebhookDeliveries(
  webhookId: WebhookId | null | undefined,
  options: { status?: DeliveryStatus; enabled?: boolean } = {}
) {
  return useInfiniteQuery({
    queryKey: webhookId
      ? webhookDeliveriesKeys.list(webhookId, options.status)
      : ['webhookDeliveries', 'none'],
    initialPageParam: null as { cursorAttemptedAt: string; cursorId: string } | null,
    queryFn: ({ pageParam }) =>
      listWebhookDeliveriesFn({
        data: {
          webhookId: webhookId!,
          status: options.status,
          cursorAttemptedAt: pageParam?.cursorAttemptedAt,
          cursorId: pageParam?.cursorId,
          limit: 50,
        },
      }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getNextPageParam: (last: any) => last?.nextCursor ?? undefined,
    enabled: !!webhookId && (options.enabled ?? true),
    staleTime: 15_000,
  })
}
