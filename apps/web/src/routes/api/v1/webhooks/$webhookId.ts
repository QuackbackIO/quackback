import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId, parseTypeIdArray } from '@/lib/server/domains/api/validation'
import { WEBHOOK_EVENTS } from '@/lib/server/events/integrations/webhook/constants'
import { toWebhookResponse } from '@/lib/server/domains/api/webhooks'
import type { BoardId, WebhookId } from '@quackback/ids'

// Input validation schema
const updateWebhookSchema = z.object({
  url: z.string().url('Invalid URL format').optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'At least one event is required').optional(),
  boardIds: z.array(z.string()).nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
})

export const Route = createFileRoute('/api/v1/webhooks/$webhookId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/webhooks/:webhookId
       * Get a single webhook by ID
       */
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'admin' })

          const webhookId = parseTypeId<WebhookId>(params.webhookId, 'webhook', 'webhook ID')

          const { getWebhookById } = await import('@/lib/server/domains/webhooks/webhook.service')
          const webhook = await getWebhookById(webhookId)

          return successResponse(toWebhookResponse(webhook))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * PATCH /api/v1/webhooks/:webhookId
       * Update a webhook
       */
      PATCH: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'admin' })

          const webhookId = parseTypeId<WebhookId>(params.webhookId, 'webhook', 'webhook ID')

          const body = await request.json()
          const parsed = updateWebhookSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const boardIds = parsed.data.boardIds != null
            ? parseTypeIdArray<BoardId>(parsed.data.boardIds, 'board', 'board IDs')
            : parsed.data.boardIds

          const { updateWebhook } = await import('@/lib/server/domains/webhooks/webhook.service')
          const webhook = await updateWebhook(webhookId, {
            url: parsed.data.url,
            events: parsed.data.events,
            boardIds,
            status: parsed.data.status,
          })

          return successResponse(toWebhookResponse(webhook))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * DELETE /api/v1/webhooks/:webhookId
       * Delete a webhook
       */
      DELETE: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'admin' })

          const webhookId = parseTypeId<WebhookId>(params.webhookId, 'webhook', 'webhook ID')

          const { deleteWebhook } = await import('@/lib/server/domains/webhooks/webhook.service')
          await deleteWebhook(webhookId)

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
