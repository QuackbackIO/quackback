import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import crypto from 'crypto'
import { withApiKeyAuth } from '@/lib/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/api/responses'
import { isValidWebhookUrl, WEBHOOK_EVENTS } from '@/lib/hooks/webhook'
import { validateTypeIdArray } from '@/lib/api/validation'

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
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          const { db } = await import('@/lib/db')

          const allWebhooks = await db.query.webhooks.findMany({
            orderBy: (table, { desc }) => [desc(table.createdAt)],
          })

          return successResponse(
            allWebhooks.map((webhook) => ({
              id: webhook.id,
              url: webhook.url,
              events: webhook.events,
              boardIds: webhook.boardIds,
              status: webhook.status,
              failureCount: webhook.failureCount,
              lastTriggeredAt: webhook.lastTriggeredAt?.toISOString() ?? null,
              createdAt: webhook.createdAt.toISOString(),
              updatedAt: webhook.updatedAt.toISOString(),
            }))
          )
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
        const authResult = await withApiKeyAuth(request)
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

          // Validate URL for SSRF protection
          if (!isValidWebhookUrl(parsed.data.url)) {
            return badRequestResponse('Invalid webhook URL', {
              detail: 'URL must be HTTPS (in production) and cannot target private networks',
            })
          }

          // Validate board IDs if provided
          if (parsed.data.boardIds && parsed.data.boardIds.length > 0) {
            const validationError = validateTypeIdArray(parsed.data.boardIds, 'board', 'board IDs')
            if (validationError) return validationError
          }

          const { db, webhooks } = await import('@/lib/db')

          // Check webhook limit (25 per workspace)
          const existingCount = await db.query.webhooks.findMany()
          if (existingCount.length >= 25) {
            return badRequestResponse('Webhook limit reached', {
              detail: 'Maximum of 25 webhooks allowed per workspace',
            })
          }

          // Generate signing secret
          const secret = `whsec_${crypto.randomBytes(32).toString('base64url')}`

          const { createId } = await import('@quackback/ids')
          const [webhook] = await db
            .insert(webhooks)
            .values({
              id: createId('webhook'),
              createdById: memberId,
              url: parsed.data.url,
              secret,
              events: parsed.data.events,
              boardIds: parsed.data.boardIds ?? null,
            })
            .returning()

          // Return with secret (only shown once)
          return createdResponse({
            id: webhook.id,
            url: webhook.url,
            secret, // Only returned on creation!
            events: webhook.events,
            boardIds: webhook.boardIds,
            status: webhook.status,
            createdAt: webhook.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
