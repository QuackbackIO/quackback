import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth, assertScopeAllowed } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import type { WebhookId } from '@quackback/ids'

const bodySchema = z.object({ eventType: z.string().min(1) })

export const Route = createFileRoute('/api/v1/webhooks/$webhookId/test')({
  server: {
    handlers: {
      /**
       * POST /api/v1/webhooks/:webhookId/test
       *
       * Synchronously deliver a canonical sample payload of `eventType` to the
       * webhook so the operator can verify URL + secret without waiting for
       * real activity. The attempt is also logged to `webhook_deliveries` so
       * it shows up in the deliveries list (eventId prefixed `evt_test_`).
       */
      POST: async ({ request, params }) => {
        try {
          const ctx = await withApiKeyAuth(request, { role: 'admin' })
          assertScopeAllowed(ctx, PERMISSIONS.ADMIN_MANAGE_API_KEYS)

          const webhookId = parseTypeId<WebhookId>(params.webhookId, 'webhook', 'webhook ID')
          const json = await request.json().catch(() => null)
          const parsed = bodySchema.safeParse(json)
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { fireTestEvent } =
            await import('@/lib/server/domains/webhooks/webhook.operator-actions')
          const outcome = await fireTestEvent({
            webhookId,
            eventType: parsed.data.eventType,
          })
          return successResponse(outcome)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
