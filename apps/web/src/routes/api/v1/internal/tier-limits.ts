import { createFileRoute } from '@tanstack/react-router'
import { db, settings } from '@/lib/server/db'
import { IS_CLOUD } from '@/lib/server/edition'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { verifyApiKeyWithScope } from '@/lib/server/domains/api-keys/api-key.service'

const SCOPE = 'internal:tier-limits'

/**
 * POST /api/v1/internal/tier-limits
 *
 * Trusted endpoint used by the cloud control plane (~/quackback-cp) to
 * write per-tenant tier limits. The body is the JSON-encoded TierLimits
 * shape (see apps/web/src/lib/server/domains/settings/tier-limits.types.ts).
 * No deep validation — the CP is the trusted writer.
 *
 * Returns 404 when EDITION != cloud so OSS bundles don't expose this.
 */
export const Route = createFileRoute('/api/v1/internal/tier-limits')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!IS_CLOUD) {
          return new Response('Not Found', { status: 404 })
        }

        const auth = request.headers.get('authorization')
        const bearer = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null
        if (!bearer) {
          return new Response(JSON.stringify({ error: 'unauthenticated' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })
        }

        const key = await verifyApiKeyWithScope(bearer, SCOPE)
        if (!key) {
          return new Response(JSON.stringify({ error: 'forbidden' }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          })
        }

        let payload: unknown
        try {
          payload = await request.json()
        } catch {
          return new Response(JSON.stringify({ error: 'invalid_json' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          })
        }

        await db.update(settings).set({ tierLimits: JSON.stringify(payload) })
        invalidateTierLimitsCache()

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    },
  },
})
