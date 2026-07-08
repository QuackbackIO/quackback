import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import type { WebhookId, WebhookDeliveryId } from '@quackback/ids'

export const Route = createFileRoute(
  '/api/v1/webhooks/$webhookId/deliveries/$deliveryId/redeliver'
)({
  server: {
    handlers: {
      /**
       * POST /api/v1/webhooks/:webhookId/deliveries/:deliveryId/redeliver
       *
       * Replay a previously-recorded delivery using its stored
       * `request_payload_json`. Bumps `attemptNumber` by 1. Returns 422 when
       * the original payload was not stored (legacy or oversized).
       */
      POST: async ({ request, params }) => {
        try {
          const ctx = await withApiKeyAuth(request, { role: 'admin' })
          assertScopeAllowed(ctx, PERMISSIONS.ADMIN_MANAGE_API_KEYS)

          // webhookId is parsed for path validation but the payload row is the
          // source of truth — guard against routing oddities only.
          parseTypeId<WebhookId>(params.webhookId, 'webhook', 'webhook ID')
          const deliveryId = parseTypeId<WebhookDeliveryId>(
            params.deliveryId,
            'wh_deliv',
            'delivery ID'
          )

          const { redeliverDelivery } =
            await import('@/lib/server/domains/webhooks/webhook.operator-actions')
          const outcome = await redeliverDelivery({ deliveryId })
          return successResponse(outcome)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
