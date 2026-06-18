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
 * Per-method enablement check. Answers "is method X allowed for role Y?"
 * Team and portal roles take different paths ({@link checkPortalAuthMethod}
 * handles `role: 'user'`), except SSO which is allowed for every role up
 * front. Hard-binding for verified-domain emails is handled separately by
 * {@link isHardBoundByVerifiedDomain} in `hooks.before` / `hooks.after`.
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
  // SSO is role-agnostic: a role governs what a user can do once signed
  // in, not whether they may authenticate. Which emails are offered SSO is
  // gated upstream by verified-domain routing and provider registration.
  if (provider === 'sso') return { allowed: true }

  if (role === 'user') {
    return checkPortalAuthMethod(provider)
  }

  const tenant = tenantSettings ?? (await getTenantSettings())
  const authConfig = tenant?.authConfig

  // Magic-link is gated by the team-side `authConfig.oauth.magicLink`
  // toggle, mirroring the password toggle. An absent key defaults to
  // enabled, so a tenant that never set it keeps team sign-in working.
  // Verified-domain hard-binding can still block magic-link for a
  // specific email; that check runs in hooks before this function is
  // reached.
  //
  // Internal token-mint paths (invitations, recovery-code-mint,
  // password-reset) bypass this gate entirely because they write the
  // verification row directly via `mintMagicLinkUrl` rather than going
  // through `auth.api.signInMagicLink`.
  if (provider === 'magic-link' || provider === 'email') {
    const enabled = authConfig?.oauth?.magicLink !== false
    return enabled ? { allowed: true } : { allowed: false, error: 'magic_link_method_not_allowed' }
  }

  // Password is gated by the team-side `authConfig.oauth.password`
  // toggle. An absent key defaults to enabled, so a tenant that never
  // set it keeps team sign-in working; an explicit `false` blocks it.
  // (`DEFAULT_AUTH_CONFIG` seeds it off, so fresh tenants opt in.)
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

  // Any other OAuth provider (google, github, custom-oidc, …) — enabled
  // iff its portal toggle is on (already filtered by credential
  // availability). SSO never reaches here: it's allowed for every role in
  // isAuthMethodAllowed.
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
 * SSO is the one provider that is never hard-bound — it *is* the
 * enforced method. Every other provider (password, magic-link, social
 * OAuth, generic OAuth) is subject to hard-binding when the candidate
 * email is at an enforced verified domain.
 *
 * Hard-binding is email-driven, not provider-allowlist-driven: an
 * enforced domain means "SSO only", full stop. Layer B gates the
 * pre-session providers (password / magic-link); Layer C
 * (`handleCallbackPolicyCleanup`) gates the OAuth-callback providers,
 * where the email is only known post token-exchange. Restricting this
 * predicate to {credential, magic-link} silently let social / generic
 * OAuth bypass enforcement.
 */
const SSO_PROVIDER_ID: AuthProvider = 'sso'

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
 * must be rejected because the candidate email is at a verified domain
 * whose `sso_verified_domain.enforced` flag is on.
 *
 * **Fails open when SSO isn't viable at runtime.** Callers pass
 * `ssoActuallyRegistered` (computed via `isSsoActuallyRegistered`) so
 * tier downgrades, missing secrets, or stale config can never cause a
 * self-lockout — a team where the IdP isn't reachable should still let
 * admins sign in via password/magic-link until the operator fixes it.
 * Recovery codes remain available as the documented break-glass either
 * way; the fail-open here covers the case where the admin doesn't know
 * about recovery codes yet.
 *
 * @param authConfig - Reserved; kept for callsite stability. Currently
 *   unused — enforcement is per-verified-domain only.
 * @param role - Reserved; kept for callsite stability. Currently unused.
 */
export function isHardBound(
  provider: AuthProvider,
  email: string | null | undefined,
  role: Role,
  authConfig: AuthConfig | undefined,
  verifiedDomains: readonly VerifiedDomain[] | undefined,
  ssoActuallyRegistered: boolean
): boolean {
  if (provider === SSO_PROVIDER_ID) return false
  if (!ssoActuallyRegistered) return false
  void authConfig
  void role

  const match = findVerifiedDomainForEmail(email, verifiedDomains)
  return match?.enforced === true
}
