import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuthAdmin } from '@/lib/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/api/responses'
import { WEBHOOK_EVENTS } from '@/lib/hooks/webhook'
import { validateTypeIdArray } from '@/lib/api/validation'
import { toWebhookListResponse } from '@/lib/api/webhooks'

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
        // Authenticate
        const authResult = await withApiKeyAuthAdmin(request)
        if (authResult instanceof Response) return authResult

        try {
          const { listWebhooks } = await import('@/lib/webhooks')
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
        // Authenticate
        const authResult = await withApiKeyAuthAdmin(request)
        if (authResult instanceof Response) return authResult
        const { memberId } = authResult

        try {
          // Parse and validate body
          const body = await request.json()
          const parsed = createWebhookSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Validate board IDs if provided
          if (parsed.data.boardIds && parsed.data.boardIds.length > 0) {
            const validationError = validateTypeIdArray(parsed.data.boardIds, 'board', 'board IDs')
            if (validationError) return validationError
          }

          const { createWebhook } = await import('@/lib/webhooks')
          const result = await createWebhook(
            {
              url: parsed.data.url,
              events: parsed.data.events,
              boardIds: parsed.data.boardIds,
            },
            memberId
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
