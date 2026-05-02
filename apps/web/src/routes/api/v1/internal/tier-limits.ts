import { createFileRoute } from '@tanstack/react-router'
import { db, settings } from '@/lib/server/db'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { verifyApiKeyWithScope } from '@/lib/server/domains/api-keys/api-key.service'

const SCOPE = 'internal:tier-limits'

/**
 * POST /api/v1/internal/tier-limits
 *
 * Trusted endpoint used by the cloud control plane (~/quackback-cp) to
 * write per-tenant tier limits. Body is the JSON-encoded TierLimits
 * shape (see apps/web/src/lib/server/domains/settings/tier-limits.types.ts).
 * No deep validation — the CP is the trusted writer.
 *
 * Self-hosters who want to impose their own limits can mint an api_keys
 * row with the `internal:tier-limits` scope and call this endpoint
 * themselves. The endpoint behaves identically regardless of who calls it.
 */
export const Route = createFileRoute('/api/v1/internal/tier-limits')({
  server: {
    handlers: {
      POST: async ({ request }) => {
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

        // Upsert. Tenant may not have onboarded yet (no settings row), so
        // bootstrap one with placeholder name+slug if missing — onboarding
        // overwrites them on first admin sign-in. The settings.slug unique
        // constraint guards against the SELECT-then-INSERT race when two
        // CPs (or one CP retrying) call concurrently.
        const tierLimitsJson = JSON.stringify(payload)
        await db
          .insert(settings)
          .values({
            name: 'Workspace',
            slug: 'workspace',
            createdAt: new Date(),
            tierLimits: tierLimitsJson,
          })
          .onConflictDoUpdate({
            target: settings.slug,
            set: { tierLimits: tierLimitsJson },
          })
        invalidateTierLimitsCache()

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    },
  },
})
