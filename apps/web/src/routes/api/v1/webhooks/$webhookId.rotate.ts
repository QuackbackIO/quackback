import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuthAdmin } from '@/lib/api/auth'
import { successResponse, handleDomainError } from '@/lib/api/responses'
import { validateTypeId } from '@/lib/api/validation'
import type { WebhookId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/webhooks/$webhookId/rotate')({
  server: {
    handlers: {
      /**
       * POST /api/v1/webhooks/:webhookId/rotate
       * Rotate a webhook's signing secret
       */
      POST: async ({ request, params }) => {
        // Authenticate (admin only)
        const authResult = await withApiKeyAuthAdmin(request)
        if (authResult instanceof Response) return authResult

        try {
          const { webhookId } = params

          // Validate TypeID format
          const validationError = validateTypeId(webhookId, 'webhook', 'webhook ID')
          if (validationError) return validationError

          const { rotateWebhookSecret } = await import('@/lib/webhooks')
          const result = await rotateWebhookSecret(webhookId as WebhookId)

          // Return the new secret (only shown once!)
          return successResponse({
            id: result.webhook.id,
            secret: result.secret,
            rotatedAt: new Date().toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
