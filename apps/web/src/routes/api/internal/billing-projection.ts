import { createFileRoute } from '@tanstack/react-router'
import { logger } from '@/lib/server/logger'
import {
  BillingProjectionWriteError,
  writeBillingProjection,
} from '@/lib/server/domains/settings/cloud/billing-projection.write'
import { verifyBillingProjectionToken } from '@/lib/server/domains/settings/cloud/billing-projection.signature'

const log = logger.child({ component: 'billing-projection-endpoint' })
const MAX_BODY_BYTES = 64 * 1024

export async function handleBillingProjection(request: Request): Promise<Response> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ error: 'payload_too_large' }, { status: 413 })
  }

  let token: string | null = null
  try {
    const body = (await request.json()) as { token?: unknown }
    token = typeof body.token === 'string' ? body.token : null
  } catch {
    // Mapped to the same non-oracular authentication response below.
  }
  if (!token) return Response.json({ error: 'invalid_projection' }, { status: 401 })

  try {
    const verified = await verifyBillingProjectionToken(token)
    const result = await writeBillingProjection(verified.workspaceKey, verified.projection)
    return result.applied ? Response.json(result) : new Response(null, { status: 204 })
  } catch (error) {
    if (error instanceof BillingProjectionWriteError) {
      const status =
        error.code === 'stale_version' || error.code === 'version_conflict'
          ? 409
          : error.code === 'settings_missing'
            ? 503
            : 403
      log.warn({ reason: error.code }, 'billing projection refused')
      return Response.json({ error: error.code }, { status })
    }
    const reason = error instanceof Error ? error.message : 'verification_failed'
    log.warn({ reason }, 'billing projection signature refused')
    return Response.json({ error: 'invalid_projection' }, { status: 401 })
  }
}

export const Route = createFileRoute('/api/internal/billing-projection')({
  server: { handlers: { POST: ({ request }) => handleBillingProjection(request) } },
})
