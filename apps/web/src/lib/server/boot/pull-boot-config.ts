/**
 * Stage 3A: pull boot config from a configured provider on every pod
 * boot. The OSS pod treats both env vars as opaque — it just GETs the
 * URL with the bearer token and applies the response per-section.
 *
 *   QUACKBACK_CONFIG_PROVIDER_URL    — the GET endpoint
 *   QUACKBACK_CONFIG_PROVIDER_TOKEN  — Bearer token for it
 *
 * Self-hosters leave both unset and this function is a no-op. Cloud
 * tenants get them projected from CP via OpenBao + ESO (see CP's
 * BOOTSTRAP_TENANT_SECRET_KEYS).
 *
 * Response is per-section-versioned so sections evolve independently:
 *
 *   { tierLimits: { version: "1", limits: { ... } },
 *     // 3B will add: bootstrap: { version: "1", ... }
 *   }
 *
 * Sections OSS doesn't recognize are ignored (forward-compat). Sections
 * with an unknown version are ignored too.
 *
 * Boot must not block on this. fetch is bounded by an AbortController
 * timeout; failures log + return rather than throw.
 */

import { eq } from 'drizzle-orm'
import { db, settings } from '@/lib/server/db'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import type { TierLimits } from '@/lib/server/domains/settings/tier-limits.types'

const FETCH_TIMEOUT_MS = 5_000

type BootConfigResponse = {
  tierLimits?: { version?: string; limits?: TierLimits }
  // Stage 3B will add: bootstrap?: { version?: string; ... }
}

export async function pullBootConfig(): Promise<void> {
  const url = process.env.QUACKBACK_CONFIG_PROVIDER_URL
  const token = process.env.QUACKBACK_CONFIG_PROVIDER_TOKEN
  if (!url || !token) return

  let body: BootConfigResponse
  try {
    body = await fetchWithTimeout(url, token, FETCH_TIMEOUT_MS)
  } catch (err) {
    console.warn('[boot] pullBootConfig: fetch failed', { err: String(err) })
    return
  }

  if (body.tierLimits?.version === '1' && body.tierLimits.limits) {
    try {
      await applyTierLimits(body.tierLimits.limits)
    } catch (err) {
      console.warn('[boot] pullBootConfig: applyTierLimits failed', { err: String(err) })
    }
  }
}

async function fetchWithTimeout(
  url: string,
  token: string,
  timeoutMs: number
): Promise<BootConfigResponse> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: ctrl.signal,
    })
    if (!res.ok) {
      throw new Error(`config-provider GET ${url} → ${res.status}`)
    }
    return (await res.json()) as BootConfigResponse
  } finally {
    clearTimeout(timer)
  }
}

async function applyTierLimits(limits: TierLimits): Promise<void> {
  const tierLimitsJson = JSON.stringify(limits)
  // Singleton-row pattern matches the existing internal POST endpoint:
  // SELECT existing → UPDATE id-targeted; INSERT only if no row exists
  // (pre-onboarding). Keying off slug would silently insert a second
  // row once the user renames their workspace.
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
}
