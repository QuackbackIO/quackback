import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/api/auth'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  notFoundResponse,
  handleDomainError,
} from '@/lib/api/responses'
import { validateTypeId, validateTypeIdArray } from '@/lib/api/validation'
import { isValidWebhookUrl, WEBHOOK_EVENTS } from '@/lib/hooks/webhook'
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
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          const { webhookId } = params

          // Validate TypeID format
          const validationError = validateTypeId(webhookId, 'webhook', 'webhook ID')
          if (validationError) return validationError

          const { db, webhooks, eq } = await import('@/lib/db')

          const webhook = await db.query.webhooks.findFirst({
            where: eq(webhooks.id, webhookId as WebhookId),
          })

          if (!webhook) {
            return notFoundResponse('Webhook')
          }

          return successResponse({
            id: webhook.id,
            url: webhook.url,
            events: webhook.events,
            boardIds: webhook.boardIds,
            status: webhook.status,
            failureCount: webhook.failureCount,
            lastError: webhook.lastError,
            lastTriggeredAt: webhook.lastTriggeredAt?.toISOString() ?? null,
            createdAt: webhook.createdAt.toISOString(),
            updatedAt: webhook.updatedAt.toISOString(),
          })
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
        const authResult = await withApiKeyAuth(request)
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

          // Validate URL if provided
          if (parsed.data.url && !isValidWebhookUrl(parsed.data.url)) {
            return badRequestResponse('Invalid webhook URL', {
              detail: 'URL must be HTTPS (in production) and cannot target private networks',
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

          const { db, webhooks, eq } = await import('@/lib/db')

          // Build update object
          const updateData: Record<string, unknown> = {
            updatedAt: new Date(),
          }
          if (parsed.data.url !== undefined) updateData.url = parsed.data.url
          if (parsed.data.events !== undefined) updateData.events = parsed.data.events
          if (parsed.data.boardIds !== undefined) updateData.boardIds = parsed.data.boardIds
          if (parsed.data.status !== undefined) {
            updateData.status = parsed.data.status
            // Reset failure count when re-enabling
            if (parsed.data.status === 'active') {
              updateData.failureCount = 0
              updateData.lastError = null
            }
          }

          const [webhook] = await db
            .update(webhooks)
            .set(updateData)
            .where(eq(webhooks.id, webhookId as WebhookId))
            .returning()

          if (!webhook) {
            return notFoundResponse('Webhook')
          }

          return successResponse({
            id: webhook.id,
            url: webhook.url,
            events: webhook.events,
            boardIds: webhook.boardIds,
            status: webhook.status,
            failureCount: webhook.failureCount,
            lastError: webhook.lastError,
            lastTriggeredAt: webhook.lastTriggeredAt?.toISOString() ?? null,
            createdAt: webhook.createdAt.toISOString(),
            updatedAt: webhook.updatedAt.toISOString(),
          })
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
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          const { webhookId } = params

          // Validate TypeID format
          const validationError = validateTypeId(webhookId, 'webhook', 'webhook ID')
          if (validationError) return validationError

          const { db, webhooks, eq } = await import('@/lib/db')

          const [deleted] = await db
            .delete(webhooks)
            .where(eq(webhooks.id, webhookId as WebhookId))
            .returning()

          if (!deleted) {
            return notFoundResponse('Webhook')
          }

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
