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
import type { WebhookId, WebhookDeliveryId } from '@quackback/ids'

const STATUSES = [
  'queued',
  'success',
  'failed_retryable',
  'failed_terminal',
  'blocked_ssrf',
] as const

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  status: z.enum(STATUSES).optional(),
  cursorAttemptedAt: z.string().datetime().optional(),
  cursorId: z.string().optional(),
})

export const Route = createFileRoute('/api/v1/webhooks/$webhookId/deliveries')({
  server: {
    handlers: {
      /**
       * GET /api/v1/webhooks/:webhookId/deliveries
       *
       * Cursor-paginated list of webhook delivery attempts.
       * Requires `admin.manage_api_keys` scope.
       */
      GET: async ({ request, params }) => {
        try {
          const ctx = await withApiKeyAuth(request, { role: 'admin' })
          assertScopeAllowed(ctx, PERMISSIONS.ADMIN_MANAGE_API_KEYS)

          const webhookId = parseTypeId<WebhookId>(params.webhookId, 'webhook', 'webhook ID')

          const url = new URL(request.url)
          const parsed = querySchema.safeParse({
            limit: url.searchParams.get('limit') ?? undefined,
            status: url.searchParams.get('status') ?? undefined,
            cursorAttemptedAt: url.searchParams.get('cursorAttemptedAt') ?? undefined,
            cursorId: url.searchParams.get('cursorId') ?? undefined,
          })
          if (!parsed.success) {
            return badRequestResponse('Invalid query parameters', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const cursor =
            parsed.data.cursorAttemptedAt && parsed.data.cursorId
              ? {
                  attemptedAt: new Date(parsed.data.cursorAttemptedAt),
                  id: parsed.data.cursorId as WebhookDeliveryId,
                }
              : null

          const { listDeliveriesForWebhook } =
            await import('@/lib/server/domains/webhooks/webhook.deliveries')
          const rows = await listDeliveriesForWebhook(webhookId, {
            cursor,
            limit: parsed.data.limit,
            statusFilter: parsed.data.status ?? null,
          })

          const nextCursor =
            rows.length === parsed.data.limit
              ? {
                  cursorAttemptedAt: rows[rows.length - 1].attemptedAt.toISOString(),
                  cursorId: rows[rows.length - 1].id,
                }
              : null

          return successResponse({
            deliveries: rows.map((r) => ({
              id: r.id,
              webhookId: r.webhookId,
              eventId: r.eventId,
              eventType: r.eventType,
              attemptNumber: r.attemptNumber,
              status: r.status,
              httpStatus: r.httpStatus,
              errorMessage: r.errorMessage,
              requestUrl: r.requestUrl,
              requestPayloadBytes: r.requestPayloadBytes,
              responseBodySnippet: r.responseBodySnippet,
              latencyMs: r.latencyMs,
              signatureTimestamp: r.signatureTimestamp,
              attemptedAt: r.attemptedAt.toISOString(),
              nextRetryAt: r.nextRetryAt?.toISOString() ?? null,
            })),
            nextCursor,
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
