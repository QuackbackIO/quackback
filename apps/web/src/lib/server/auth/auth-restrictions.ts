/**
 * Auth Restrictions — request-time policy oracle for sign-in attempts.
 *
 * Wired by Better-Auth's per-endpoint `hooks.before` middleware (Layer B)
 * for paths where the email is in `ctx.body` (password, magic-link,
 * email-OTP). For OAuth callback paths the email isn't known until
 * after the upstream token exchange, so policy enforcement on those
 * paths is split between Layer A (provider registration filter) and
 * Layer C (`hooks.after` compensating cleanup).
 *
 * Provider-id conventions follow Better-Auth's path-derived ids:
 *   - 'credential'   — email/password
 *   - 'magic-link'   — magic-link or email-OTP (one combined method)
 *   - 'sso'          — the genericOAuth provider with id 'sso'
 *   - other          — built-in social ('google', 'github') or generic
 *                       OAuth provider id
 *
 * Hard-binding is per-domain: when a verified-domain row has
 * `enforced=true`, emails at that domain are blocked from password /
 * magic-link / non-SSO OAuth. Without enforcement, verification is
 * routing-only and other methods stay open.
 */

import {
  getPublicPortalConfig,
  getTenantSettings,
} from '@/lib/server/domains/settings/settings.service'
import { emailDomain } from '@/lib/server/auth/normalize-domain'
import type { AuthConfig, VerifiedDomain } from '@/lib/server/domains/settings/settings.types'

export type AuthProvider = 'email' | 'credential' | 'magic-link' | 'sso' | string
export type Role = 'admin' | 'member' | 'user'

interface AuthMethodResult {
  allowed: boolean
  error?: string
}

/**
 * Per-method enablement check for the team surface. Hard-binding for
 * verified-domain emails is handled separately by
 * {@link isHardBoundByVerifiedDomain} in `hooks.before` / `hooks.after`;
 * this function just answers "is method X turned on for the team?"
 *
 * @param provider - Path-derived provider id ('credential' | 'magic-link' | 'sso' | provider id)
 * @param role - The principal's role
 * @returns Whether the auth method is allowed, with optional error code
 */
export async function isAuthMethodAllowed(
  provider: AuthProvider,
  role: Role,
  /** Optional pre-fetched tenant settings to skip the cache hit. Used
   *  by hooks.ts where the same settings already drove a hard-binding
   *  check earlier in the request — passing it through avoids a
   *  redundant Redis round-trip per sign-in attempt. */
  tenantSettings?: Awaited<ReturnType<typeof getTenantSettings>>
): Promise<AuthMethodResult> {
  if (role === 'user') {
    return checkPortalAuthMethod(provider)
  }

  const tenant = tenantSettings ?? (await getTenantSettings())
  const authConfig = tenant?.authConfig

  // Magic-link is gated by the team-side `authConfig.oauth.magicLink`
  // toggle, mirroring the password toggle. Defaults to enabled — pre-
  // 0.12 tenants had no `magicLink` key and we keep their team sign-in
  // working post-upgrade. Verified-domain hard-binding can still block
  // magic-link for a specific email; that check runs in hooks before
  // this function is reached.
  //
  // Internal token-mint paths (invitations, recovery-code-mint,
  // password-reset) bypass this gate entirely because they write the
  // verification row directly via `mintMagicLinkUrl` rather than going
  // through `auth.api.signInMagicLink`.
  if (provider === 'magic-link' || provider === 'email') {
    const enabled = authConfig?.oauth?.magicLink !== false
    return enabled ? { allowed: true } : { allowed: false, error: 'magic_link_method_not_allowed' }
  }

  if (provider === 'sso') return { allowed: true }

  // Password is gated by the team-side authConfig.oauth.password.
  // Defaults to enabled when the key is absent so v0.9.9 tenants who
  // never had `password` in their stored authConfig keep their team
  // sign-in working after upgrade. Explicit `false` blocks.
  // toggle. Default-false in DEFAULT_AUTH_CONFIG matches the previous
  // hardcoded /admin/login behavior.
  if (provider === 'credential' || provider === 'password') {
    const enabled = authConfig?.oauth?.password !== false
    return enabled ? { allowed: true } : { allowed: false, error: 'password_method_not_allowed' }
  }

  // Any other OAuth provider is gated by authConfig.oauth.<provider>
  // and must also have credentials configured.
  const teamEnabled = authConfig?.oauth?.[provider] === true
  if (!teamEnabled) return { allowed: false, error: 'oauth_method_not_allowed' }

  const { hasPlatformCredentials } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')
  const hasCredentials = await hasPlatformCredentials(`auth_${provider}`)
  return hasCredentials ? { allowed: true } : { allowed: false, error: 'oauth_method_not_allowed' }
}

async function checkPortalAuthMethod(provider: AuthProvider): Promise<AuthMethodResult> {
  // getPublicPortalConfig already filters by credential availability
  const portalConfig = await getPublicPortalConfig()

  // Path-derived provider ids from hooks.ts:
  //   '/sign-in/email' → 'credential'   (Better-Auth's name for email+password)
  //   '/sign-in/magic-link' / '/magic-link/verify' / email-OTP → 'magic-link'
  // Portal config uses different keys ('password' and 'magicLink') for
  // historical reasons. Normalize here so the policy answers the right
  // question regardless of caller convention.
  if (provider === 'credential' || provider === 'password') {
    const enabled = portalConfig.oauth.password ?? true
    return enabled ? { allowed: true } : { allowed: false, error: 'password_method_not_allowed' }
  }

  if (provider === 'magic-link' || provider === 'magicLink' || provider === 'email') {
    // `magicLink` portal toggle is the authoritative key; legacy
    // `email` (OTP) was retired in migration 0049 and folded into
    // magic-link. Default off — admin must opt portal users in.
    const enabled = portalConfig.oauth.magicLink ?? false
    return enabled ? { allowed: true } : { allowed: false, error: 'magic_link_method_not_allowed' }
  }

  // Any OAuth provider — check if enabled (already filtered by credential availability)
  const enabled = portalConfig.oauth[provider]
  return enabled ? { allowed: true } : { allowed: false, error: 'oauth_method_not_allowed' }
}

/**
 * Find the verified-domain row whose `name` matches the candidate
 * email's domain (case- and trailing-dot-insensitive via `emailDomain`).
 * A row only matches when it's actually verified (`verifiedAt !== null`).
 * Returns `null` when no row matches.
 */
export function findVerifiedDomainForEmail(
  email: string | null | undefined,
  verifiedDomains: readonly VerifiedDomain[] | undefined
): VerifiedDomain | null {
  if (!email || !verifiedDomains?.length) return null
  const candidate = emailDomain(email)
  if (candidate === null) return null
  return verifiedDomains.find((d) => d.verifiedAt !== null && d.name === candidate) ?? null
}

/**
 * Routing predicate: the email belongs to one of the workspace's
 * verified SSO domains. Used to default the login form to "Continue
 * with SSO" and to auto-redirect when that row also has `enforced=true`.
 * Does NOT imply other methods are blocked — see
 * {@link isHardBoundByVerifiedDomain} for the policy gate.
 */
export function isEmailAtVerifiedDomain(
  email: string | null | undefined,
  verifiedDomains: readonly VerifiedDomain[] | undefined
): boolean {
  return findVerifiedDomainForEmail(email, verifiedDomains) !== null
}

/**
 * Providers that hooks.before can hard-bind in-line — i.e. those whose
 * sign-in body carries the email pre-session, so we can reject the
 * request before any token exchange. OAuth callback paths aren't here;
 * Layer C in `hooks.after` covers them.
 *
 * Magic-link is included alongside `credential` because anyone with
 * inbox control at the verified domain (catch-all, contractor address,
 * former employee with retained access) could otherwise self-issue a
 * sign-in token that bypasses the IdP's role/MFA attestations.
 */
const HARD_BOUND_PROVIDERS = new Set<AuthProvider>(['credential', 'magic-link'])

/**
 * Layer-1 predicate: did the admin configure SSO to be on?
 *
 * Pure check of admin intent. Use when you need to know whether
 * downstream SSO state (`required`, verified-domain `enforced`) is in
 * play at all. Does NOT verify that SSO is actually viable right now —
 * use {@link isHardBound} for enforcement (which fails open on runtime
 * unavailability) or `isSsoActuallyRegistered` for the full viability
 * check (admin intent + tier + secret).
 *
 * Type predicate: narrows `sso` to non-undefined inside the guarded
 * branch so callers don't need to re-check.
 */
export function isSsoConfigured(
  sso: AuthConfig['ssoOidc']
): sso is NonNullable<AuthConfig['ssoOidc']> {
  return sso?.enabled === true
}

/**
 * Unified hard-binding predicate. Returns true when the sign-in attempt
 * must be rejected because of:
 *
 *  - the per-domain `sso_verified_domain.enforced` flag (per-domain branch), OR
 *  - the workspace-wide `authConfig.ssoOidc.required` flag, which binds
 *    every admin/member regardless of email domain.
 *
 * Magic-link can escape the workspace-wide branch when
 * `allowMagicLinkUnderRequired` is set — operators who want to keep a
 * cross-IdP break-glass.
 *
 * Portal users (role='user') are never bound by the workspace-wide
 * branch — they're not gated by SSO at all. The per-domain branch
 * still applies because that's email-driven, not role-driven.
 *
 * **Fails open when SSO isn't viable at runtime.** Callers pass
 * `ssoActuallyRegistered` (computed via `isSsoActuallyRegistered`) so
 * tier downgrades, missing secrets, or stale config can never cause a
 * self-lockout — a team where the IdP isn't reachable should still let
 * admins sign in via password/magic-link until the operator fixes it.
 * Recovery codes remain available as the documented break-glass either
 * way; the fail-open here covers the case where the admin doesn't know
 * about recovery codes yet.
 */
export function isHardBound(
  provider: AuthProvider,
  email: string | null | undefined,
  role: Role,
  authConfig: AuthConfig | undefined,
  verifiedDomains: readonly VerifiedDomain[] | undefined,
  ssoActuallyRegistered: boolean
): boolean {
  if (!HARD_BOUND_PROVIDERS.has(provider)) return false
  if (!ssoActuallyRegistered) return false

  const sso = authConfig?.ssoOidc
  const isTeamRole = role === 'admin' || role === 'member'
  if (isTeamRole && sso?.required === true) {
    // Magic-link escape: only when explicitly opted into.
    if (provider === 'magic-link' && sso.allowMagicLinkUnderRequired === true) {
      // Workspace-wide branch doesn't bind, but a per-domain enforced
      // row still might — fall through.
    } else {
      return true
    }
  }

  const match = findVerifiedDomainForEmail(email, verifiedDomains)
  return match?.enforced === true
}
