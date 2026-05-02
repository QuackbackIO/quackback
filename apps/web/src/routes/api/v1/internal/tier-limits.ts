import { createFileRoute } from '@tanstack/react-router'
import { db, settings } from '@/lib/server/db'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { authenticateInternal } from '@/lib/server/domains/api-keys/internal-auth'
import { SCOPE_INTERNAL_TIER_LIMITS } from '@/lib/server/domains/api-keys/scopes'

/**
 * POST /api/v1/internal/tier-limits
 *
 * Trusted endpoint used by the cloud control plane (~/quackback-cp) to
 * write per-tenant tier limits. Body is the JSON-encoded TierLimits
 * shape (see apps/web/src/lib/server/domains/settings/tier-limits.types.ts).
 * No deep validation — the caller carries the internal:tier-limits scope
 * and is the trusted writer.
 */
export const Route = createFileRoute('/api/v1/internal/tier-limits')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateInternal(request, SCOPE_INTERNAL_TIER_LIMITS)
        if (auth instanceof Response) return auth

        let payload: unknown
        try {
          payload = await request.json()
        } catch {
          return new Response(JSON.stringify({ error: 'invalid_json' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          })
        }

        // Upsert via the unique slug. Tenant may not have onboarded yet;
        // bootstrap a placeholder row so the CP can configure tier limits
        // before first admin sign-in. Onboarding overwrites name+slug later.
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
