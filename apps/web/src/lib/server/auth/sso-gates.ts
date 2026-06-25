/**
 * Pure SSO-gate predicates. Fully standalone (no imports) so both the
 * settings service and the SSO server functions can use them without an
 * import cycle.
 *
 * The shared idea: a successful test sign-in (or, for enforcement, a
 * real team SSO sign-in) only "vouches" for the current config if it
 * happened AFTER the most recent connection-affecting change. The
 * config tracks that change via `detailsChangedAt`, stamped whenever
 * `discoveryUrl` / `clientId` / the client secret changes.
 */

/**
 * Freshness timestamps the gates compare. Structurally satisfied by both the
 * legacy `AuthConfig['ssoOidc']` blob (ISO strings) and an `IdentityProvider`
 * row (ISO strings on the DTO, `Date` on `$inferSelect`), so per-provider
 * callers can pass a provider directly without converting.
 */
interface SsoFreshness {
  detailsChangedAt?: Date | string | null
  lastSuccessfulTestAt?: Date | string | null
}

/**
 * Normalize a timestamp to epoch ms, or `null` when absent/unparseable.
 * Accepts `Date` as well as ISO strings — a provider row's columns are
 * `Date`, while the DTO / legacy `ssoOidc` blob carry ISO strings.
 */
function ms(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime()
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
export function isSsoTestValid(sso: SsoFreshness | undefined): boolean {
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
 *
 * **Per-provider scoping (Task 13).** The provider's own
 * `lastSuccessfulTestAt` (the {@link isSsoTestValid} branch) is genuinely
 * per-provider — it's the admin's identity-matched test against THIS
 * provider. The `lastRealSignInAt` branch is NOT: `principal.lastSsoSignInAt`
 * is stamped on every OIDC sign-in regardless of which provider authenticated
 * (the column is provider-independent), so in a multi-provider workspace a
 * real sign-in via working provider B would also satisfy this branch for
 * never-validated provider A. In the single-provider workspace this code path
 * still serves, it's unambiguous. For strict per-provider enforcement, pass
 * `null` for `lastRealSignInAt` and rely solely on the provider's own
 * `lastSuccessfulTestAt`; a per-provider real-sign-in proof would need a new
 * schema column, which is intentionally NOT introduced here.
 */
export function isSsoEnforcementUnlocked(
  sso: SsoFreshness | undefined,
  lastRealSignInAt: Date | string | null
): boolean {
  if (isSsoTestValid(sso)) return true
  const signedInAt = ms(lastRealSignInAt)
  if (signedInAt === null) return false
  const changedAt = ms(sso?.detailsChangedAt)
  if (changedAt === null) return true
  return signedInAt > changedAt
}
