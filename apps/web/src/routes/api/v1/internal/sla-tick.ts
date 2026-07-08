/**
 * POST /api/v1/internal/sla-tick
 *
 * Internal endpoint that runs one SLA escalation tick. Protected by a shared
 * secret; intended to be invoked by an external scheduler (Railway cron, an
 * external HTTP cron service, or pg_cron + pg_net).
 *
 * Header: `x-internal-secret: <env.INTERNAL_TASK_SECRET>`
 */
import { createFileRoute } from '@tanstack/react-router'
import {
  successResponse,
  forbiddenResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { runEscalationTick } from '@/lib/server/domains/sla'

export const Route = createFileRoute('/api/v1/internal/sla-tick')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const expected = process.env.INTERNAL_TASK_SECRET
          if (!expected) {
            return forbiddenResponse('INTERNAL_TASK_SECRET is not configured')
          }
          const provided = request.headers.get('x-internal-secret')
          if (!provided || provided !== expected) {
            return forbiddenResponse('Invalid internal secret')
          }
          let body: { batchSize?: number } | null = null
          try {
            body = (await request.json()) as { batchSize?: number } | null
          } catch {
            body = null
          }
          const result = await runEscalationTick({ batchSize: body?.batchSize })
          return successResponse(result)
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
