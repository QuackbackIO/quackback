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
 *   - OIDC reg id    — a genericOAuth provider's registrationId
 *                       (incl. the preserved legacy 'sso' / 'custom-oidc')
 *   - social id      — built-in social ('google', 'github', …)
 *
 * Hard-binding is per-domain AND per-owning-provider: when a verified-domain
 * row has `enforced=true`, emails at that domain are blocked from every
 * method EXCEPT the owning provider's own OIDC callback — password,
 * magic-link, social, and a *different* OIDC provider are all blocked.
 * Without enforcement, verification is routing-only and other methods stay
 * open.
 */

import { getTenantSettings } from '@/lib/server/domains/settings/settings.service'
import { isSignInMethodEnabled, normalizeMethodKey } from '@/lib/shared/signin-methods'
import {
  findProviderForDomainEmail,
  isRegisteredOidcProvider,
  shouldRenderPublicButton,
  type ProviderWithDomains,
} from '@/lib/server/auth/provider-ids'
import { isTeamMember } from '@/lib/shared/roles'

export type AuthProvider = 'email' | 'credential' | 'magic-link' | 'sso' | string
export type Role = 'admin' | 'member' | 'user'

interface AuthMethodResult {
  allowed: boolean
  error?: string
}

/**
 * Per-method enablement check. Answers "is method X enabled in authConfig.oauth?"
 * All roles — team (admin/member) and portal (user) — read the same
 * `authConfig.oauth` map via {@link isSignInMethodEnabled}. OIDC eligibility
 * per role is a separate concern handled by {@link isSsoBlockedForRole}.
 * Any registered OIDC provider id is allowed at this layer for every role;
 * per-domain eligibility is enforced at the callback.
 *
 * Hard-binding for verified-domain emails is handled separately by
 * {@link isHardBound} in `hooks.before` / `hooks.after`.
 *
 * @param provider - Path-derived provider id ('credential' | 'magic-link' | OIDC registrationId | social id)
 * @param _role - The principal's role. No longer gates method enablement here;
 *   kept positionally for callers in hooks.ts. Role governs OIDC eligibility
 *   in the sibling {@link isSsoBlockedForRole}.
 * @param registeredOidcProviderIds - Currently-registered OIDC provider ids.
 *   Any provider in this set is "allowed" at this layer (its per-domain
 *   eligibility is enforced at the callback via {@link isSsoBlockedForRole} /
 *   hard-binding), exactly as the literal `'sso'` id was before the registry
 *   generalized provider dispatch.
 * @returns Whether the auth method is allowed, with optional error code
 */
export async function isAuthMethodAllowed(
  provider: AuthProvider,
  _role: Role,
  registeredOidcProviderIds: Set<string>,
  /** Optional pre-fetched tenant settings to skip the cache hit. Used
   *  by hooks.ts where the same settings already drove a hard-binding
   *  check earlier in the request — passing it through avoids a
   *  redundant Redis round-trip per sign-in attempt. */
  tenantSettings?: Awaited<ReturnType<typeof getTenantSettings>>
): Promise<AuthMethodResult> {
  // Any registered OIDC provider is a method for every role; role governs
  // authorization, not whether the method exists. Portal-side eligibility
  // (verified domain owned by THIS provider) is enforced at the callback —
  // see `isSsoBlockedForRole` / `handleCallbackPolicyCleanup`.
  if (isRegisteredOidcProvider(provider, registeredOidcProviderIds)) return { allowed: true }

  const tenant = tenantSettings ?? (await getTenantSettings())
  const oauth = tenant?.authConfig?.oauth
  const key = normalizeMethodKey(provider)

  if (key === 'password') {
    return isSignInMethodEnabled(oauth, 'password')
      ? { allowed: true }
      : { allowed: false, error: 'password_method_not_allowed' }
  }
  if (key === 'magicLink') {
    return isSignInMethodEnabled(oauth, 'magicLink')
      ? { allowed: true }
      : { allowed: false, error: 'magic_link_method_not_allowed' }
  }
  // Social provider: enabled flag + credentials present.
  if (!isSignInMethodEnabled(oauth, key)) {
    return { allowed: false, error: 'oauth_method_not_allowed' }
  }
  const { hasPlatformCredentials } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')
  const hasCredentials = await hasPlatformCredentials(`auth_${key}`)
  return hasCredentials ? { allowed: true } : { allowed: false, error: 'oauth_method_not_allowed' }
}

/**
 * Portal-side OIDC eligibility gate. A non-team role (portal user) may
 * complete an OIDC sign-in only from a verified domain owned by *the
 * callback provider*; team roles (admin/member) are granted deliberately
 * (bootstrap / invitation), so their OIDC sign-in is unconditional.
 *
 * Scoped to the callback provider (not all workspace domains): a portal
 * user completing provider X's callback is eligible only if their email is
 * at one of X's verified domains. Routing to provider Y's domain via X must
 * not pass. Evaluated at the OAuth callback where the IdP-asserted email is
 * finally known: the login UI only *offers* a provider on a verified-domain
 * match, but a direct OAuth start skips that routing, so this is the
 * enforcing gate. Sibling of {@link isHardBound} — complementary concern
 * (an OIDC provider's own callback is never hard-bound).
 */
export function isSsoBlockedForRole(
  role: Role,
  email: string | null | undefined,
  provider: AuthProvider,
  providers: readonly ProviderWithDomains[] | undefined
): boolean {
  if (isTeamMember(role)) return false
  const callbackProvider = providers?.find((p) => p.registrationId === provider)
  // Unknown provider → not eligible (fail closed for portal users).
  if (!callbackProvider) return true
  // If the provider is offered as a public sign-in button, portal users are
  // eligible by virtue of that — the SAME predicate that decides whether the
  // button renders (`shouldRenderPublicButton`: no verified domain, OR a routed
  // provider the admin opted back in via `showButton`). Requiring a domain
  // match for a button provider would block every portal user who clicks it —
  // and the brand-new-shell cleanup would then DELETE their just-created
  // account. The gate and the button-render must share this predicate so they
  // can never disagree.
  if (shouldRenderPublicButton(callbackProvider)) return false
  // Routed-only provider: eligible iff the email is at one of its verified
  // domains.
  return findProviderForDomainEmail(email, [callbackProvider]) === null
}

/**
 * Unified hard-binding predicate. Returns true when the sign-in attempt
 * must be rejected because the candidate email is at an *enforced* verified
 * domain and the callback provider is NOT that domain's owning provider.
 *
 * **The load-bearing security rule (C2):** the only callback exempt from
 * the block is the one that IS the owning provider of the email's matched
 * enforced domain. Exempting *every* registered OIDC provider would let a
 * second provider B that can assert an enforced domain's email bypass the
 * owning provider A's enforcement — so the exemption is owner-scoped, not
 * "any OIDC provider". Everything else (password, magic-link, social, AND a
 * different OIDC provider) is blocked.
 *
 * **Fails open — but scoped to the owner — when the IdP isn't viable.** If
 * the enforced domain's OWN provider isn't currently registered (tier
 * downgrade, missing secret, disabled) the block lifts so admins aren't
 * locked out. The gate is `registeredProviderIds.has(owner.registrationId)`,
 * NOT a global "is any provider registered" — failing open on an unrelated
 * provider being unregistered would reopen the C2 hole. Recovery codes
 * remain the documented break-glass either way.
 *
 * @param provider - The callback provider id under evaluation.
 * @param email - Candidate email; its domain selects the owning provider.
 * @param providers - Identity providers with their linked verified domains
 *   (from `listIdentityProviders`). Source of both the matched domain's
 *   `enforced` flag and the owner's `registrationId`.
 * @param registeredProviderIds - OIDC provider ids registered right now.
 *   Used only for the owner-scoped fail-open check.
 */
export function isHardBound(
  provider: AuthProvider,
  email: string | null | undefined,
  providers: readonly ProviderWithDomains[] | undefined,
  registeredProviderIds: Set<string>
): boolean {
  const owner = findProviderForDomainEmail(email, providers)
  // Not at an enforced verified domain → no hard-binding.
  if (!owner || owner.enforced !== true) return false
  // Owner's IdP not viable right now → fail open (scoped to the owner) so a
  // tier downgrade / missing secret can't self-lock the workspace.
  if (!registeredProviderIds.has(owner.registrationId)) return false
  // The owning provider's own callback IS the enforced method → exempt.
  if (provider === owner.registrationId) return false
  // Everything else (password, magic-link, social, a different OIDC) → block.
  return true
}
