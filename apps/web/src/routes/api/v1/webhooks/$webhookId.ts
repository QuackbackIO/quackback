import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { validateTypeId, validateTypeIdArray } from '@/lib/server/domains/api/validation'
import { WEBHOOK_EVENTS } from '@/lib/server/events/integrations/webhook/constants'
import { toWebhookResponse } from '@/lib/server/domains/api/webhooks'
import type { WebhookId } from '@quackback/ids'

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
        // Authenticate
        const authResult = await withApiKeyAuth(request, { role: 'admin' })
        if (authResult instanceof Response) return authResult

        try {
          const { webhookId } = params

          // Validate TypeID format
          const validationError = validateTypeId(webhookId, 'webhook', 'webhook ID')
          if (validationError) return validationError

          const { getWebhookById } = await import('@/lib/server/domains/webhooks')
          const webhook = await getWebhookById(webhookId as WebhookId)

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
        // Authenticate
        const authResult = await withApiKeyAuth(request, { role: 'admin' })
        if (authResult instanceof Response) return authResult

        try {
          const { webhookId } = params

          // Validate TypeID format
          const validationError = validateTypeId(webhookId, 'webhook', 'webhook ID')
          if (validationError) return validationError

          // Parse and validate body
          const body = await request.json()
          const parsed = updateWebhookSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Validate board IDs if provided
          if (parsed.data.boardIds && parsed.data.boardIds.length > 0) {
            const boardValidationError = validateTypeIdArray(
              parsed.data.boardIds,
              'board',
              'board IDs'
            )
            if (boardValidationError) return boardValidationError
          }

          const { updateWebhook } = await import('@/lib/server/domains/webhooks')
          const webhook = await updateWebhook(webhookId as WebhookId, {
            url: parsed.data.url,
            events: parsed.data.events,
            boardIds: parsed.data.boardIds,
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
        // Authenticate
        const authResult = await withApiKeyAuth(request, { role: 'admin' })
        if (authResult instanceof Response) return authResult

        try {
          const { webhookId } = params

          // Validate TypeID format
          const validationError = validateTypeId(webhookId, 'webhook', 'webhook ID')
          if (validationError) return validationError

          const { deleteWebhook } = await import('@/lib/server/domains/webhooks')
          await deleteWebhook(webhookId as WebhookId)

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
