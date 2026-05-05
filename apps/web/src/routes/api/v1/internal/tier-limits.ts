import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { db, settings } from '@/lib/server/db'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { resetAuth } from '@/lib/server/auth/index'
import { authenticateInternal } from '@/lib/server/domains/api-keys/internal-auth'
import { SCOPE_INTERNAL_TIER_LIMITS } from '@/lib/server/domains/api-keys/scopes'

/**
 * POST /api/v1/internal/tier-limits
 *
 * Trusted endpoint for writing this workspace's tier limits. Used by an
 * external orchestrator or operator script to cap features and counts on
 * a per-workspace basis. Body is the JSON-encoded TierLimits shape (see
 * apps/web/src/lib/server/domains/settings/tier-limits.types.ts). No deep
 * validation — the caller carries the internal:tier-limits scope and is
 * the trusted writer.
 *
 * Self-hosters can ignore this endpoint; the default (no row) is unlimited.
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

        // The settings table is a singleton in OSS. Find the row by id
        // and UPDATE it; fall back to INSERT only on the very first call
        // (pre-onboarding). Keying off slug would silently insert a
        // SECOND row once the user renames their workspace, and
        // getTierLimits() reads LIMIT 1 nondeterministically.
        const tierLimitsJson = JSON.stringify(payload)
        const existing = await db.select({ id: settings.id }).from(settings).limit(1)
        if (existing[0]) {
          await db
            .update(settings)
            .set({ tierLimits: tierLimitsJson })
            .where(eq(settings.id, existing[0].id))
        } else {
          await db
            .insert(settings)
            .values({
              name: 'Workspace',
              slug: 'workspace',
              createdAt: new Date(),
              tierLimits: tierLimitsJson,
            })
            .onConflictDoNothing({ target: settings.slug })
        }
        invalidateTierLimitsCache()
        // The auth instance caches `tierLimits.features.customOidcProvider`
        // at build time so the genericOAuth plugin can be conditionally
        // registered. Reset it so a tier change (e.g. Pro → Starter)
        // immediately stops accepting SSO logins.
        resetAuth()

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    },
  },
})
