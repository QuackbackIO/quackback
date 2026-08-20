import { createFileRoute } from '@tanstack/react-router'
import { logger } from '@/lib/server/logger'
import {
  IdentityProjectionWriteError,
  writeIdentityProjection,
} from '@/lib/server/domains/settings/cloud/identity-projection.write'
import { verifyIdentityProjectionToken } from '@/lib/server/domains/settings/cloud/identity-projection.signature'

const log = logger.child({ component: 'identity-projection-endpoint' })
const MAX_BODY_BYTES = 64 * 1024

export async function handleIdentityProjection(request: Request): Promise<Response> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ error: 'payload_too_large' }, { status: 413 })
  }
  let token: string | null = null
  try {
    const body = (await request.json()) as { token?: unknown }
    token = typeof body.token === 'string' ? body.token : null
  } catch {
    // Deliberately mapped to the same non-oracular response as a bad signature.
  }
  if (!token) return Response.json({ error: 'invalid_projection' }, { status: 401 })

  try {
    const verified = await verifyIdentityProjectionToken(token)
    const result = await writeIdentityProjection(verified.workspaceKey, verified.projection)
    return result.applied ? Response.json(result) : new Response(null, { status: 204 })
  } catch (error) {
    if (error instanceof IdentityProjectionWriteError) {
      const status =
        error.code === 'stale_version' || error.code === 'version_conflict'
          ? 409
          : error.code === 'settings_missing'
            ? 503
            : 403
      log.warn({ reason: error.code }, 'identity projection refused')
      return Response.json({ error: error.code }, { status })
    }
    log.warn(
      { reason: error instanceof Error ? error.message : 'verification_failed' },
      'identity projection signature refused'
    )
    return Response.json({ error: 'invalid_projection' }, { status: 401 })
  }
}

export const Route = createFileRoute('/api/internal/identity-projection')({
  server: { handlers: { POST: ({ request }) => handleIdentityProjection(request) } },
})
