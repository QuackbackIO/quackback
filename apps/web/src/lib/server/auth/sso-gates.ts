/**
 * Pure SSO-gate predicates. Standalone (imports only the `AuthConfig`
 * type) so both the settings service and the SSO server functions can
 * use them without an import cycle.
 *
 * The shared idea: a successful test sign-in (or, for enforcement, a
 * real team SSO sign-in) only "vouches" for the current config if it
 * happened AFTER the most recent connection-affecting change. The
 * config tracks that change via `ssoOidc.detailsChangedAt`, stamped
 * whenever `discoveryUrl` / `clientId` / the client secret changes.
 */

import type { AuthConfig } from '@/lib/server/domains/settings/settings.types'

type SsoConfig = AuthConfig['ssoOidc']

/** Parse an ISO string to epoch ms, or `null` when absent/unparseable. */
function ms(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * Gate for **enabling SSO** (`ssoOidc.enabled = true`).
 *
 * True when a successful test sign-in postdates the last
 * connection-affecting change. A real production sign-in can't satisfy
 * this — SSO isn't on yet, so the test is the only possible proof.
 *
 * `detailsChangedAt` absent → treat the test as still valid (a config
 * that has never recorded a details change predates this feature; we
 * don't retroactively invalidate it). `lastSuccessfulTestAt` absent →
 * never tested → not valid.
 */
export function isSsoTestValid(sso: SsoConfig | undefined): boolean {
  const testedAt = ms(sso?.lastSuccessfulTestAt)
  if (testedAt === null) return false
  const changedAt = ms(sso?.detailsChangedAt)
  if (changedAt === null) return true
  return testedAt > changedAt
}

/**
 * Gate for **per-domain enforcement** (`sso_verified_domain.enforced`).
 *
 * True when SSO is proven working after the last details change —
 * either via a test sign-in (see {@link isSsoTestValid}) OR a real team
 * SSO sign-in. `lastRealSignInAt` is the most recent
 * `principal.lastSsoSignInAt` across the team (null when nobody has
 * signed in via SSO yet).
 */
export function isSsoEnforcementUnlocked(
  sso: SsoConfig | undefined,
  lastRealSignInAt: Date | string | null
): boolean {
  if (isSsoTestValid(sso)) return true
  const signedInAt =
    lastRealSignInAt instanceof Date ? lastRealSignInAt.getTime() : ms(lastRealSignInAt)
  if (signedInAt === null) return false
  const changedAt = ms(sso?.detailsChangedAt)
  if (changedAt === null) return true
  return signedInAt > changedAt
}
