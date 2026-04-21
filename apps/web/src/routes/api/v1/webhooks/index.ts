import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { WEBHOOK_EVENTS } from '@/lib/server/events/integrations/webhook/constants'
import { parseTypeIdArray } from '@/lib/server/domains/api/validation'
import { toWebhookListResponse } from '@/lib/server/domains/api/webhooks'
import type { BoardId } from '@quackback/ids'

// Input validation schema
const createWebhookSchema = z.object({
  url: z.string().url('Invalid URL format'),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'At least one event is required'),
  boardIds: z.array(z.string()).optional(),
})

export const Route = createFileRoute('/api/v1/webhooks/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/webhooks
       * List all webhooks
       */
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { role: 'admin' })

          const { listWebhooks } = await import('@/lib/server/domains/webhooks/webhook.service')
          const allWebhooks = await listWebhooks()

          return successResponse(allWebhooks.map(toWebhookListResponse))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * POST /api/v1/webhooks
       * Create a new webhook
       */
      POST: async ({ request }) => {
        try {
          const { principalId } = await withApiKeyAuth(request, { role: 'admin' })

          const body = await request.json()
          const parsed = createWebhookSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const boardIds = parseTypeIdArray<BoardId>(parsed.data.boardIds, 'board', 'board IDs')

          const { createWebhook } = await import('@/lib/server/domains/webhooks/webhook.service')
          const result = await createWebhook(
            {
              url: parsed.data.url,
              events: parsed.data.events,
              boardIds,
            },
            principalId
          )

          // Return with secret (only shown once)
          return createdResponse({
            id: result.webhook.id,
            url: result.webhook.url,
            secret: result.secret, // Only returned on creation!
            events: result.webhook.events,
            boardIds: result.webhook.boardIds,
            status: result.webhook.status,
            createdAt: result.webhook.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
