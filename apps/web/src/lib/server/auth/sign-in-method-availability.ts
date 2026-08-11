/**
 * Last-sign-in-method lockout guard (server side).
 *
 * The UI disables the "remove"/"disable" affordances when a provider is the
 * only working sign-in method, but the server functions are the real
 * chokepoint — a direct API call must not be able to strip the workspace of
 * its last way in. `deleteIdentityProviderFn` and the disable path of
 * `upsertIdentityProviderFn` call {@link checkIsOnlyWorkingSignInMethod} and
 * refuse the mutation when it returns true.
 *
 * Auth on this branch is UNIFIED — one set of sign-in methods for everyone,
 * stored in `authConfig.oauth`, and any registered OIDC provider usable by
 * every role. "Working" reads the single unified config:
 *   - password   — `oauth.password !== false` (absent ⇒ on).
 *   - magic link — `oauth.magicLink === true` (absent ⇒ off, opt-in) AND email delivery is wired.
 *   - social     — `oauth[id] === true` (absent ⇒ off, opt-in) AND its credentials are saved.
 *   - identity provider — registered (tier on + enabled + secret saved).
 *
 * Each check is read-then-write (no lock across the check and the mutation), so
 * two *simultaneous* admin requests each disabling a *different* one of the last
 * two methods could both pass and reach zero. The window is sub-millisecond and
 * the actors are admins; `/auth/recovery` is the documented break-glass, so this
 * is accepted rather than serialized behind an advisory lock.
 */

import type { IdentityProviderId } from '@quackback/ids'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { isSignInMethodEnabled } from '@/lib/shared/signin-methods'

export interface WorkingMethodInputs {
  /** Whether the `customOidcProvider` tier feature is on. The runtime only
   *  registers OIDC providers when it is, so a tier-off workspace has no
   *  working IdP however many are enabled + configured. */
  tierEnabled: boolean
  /** Every identity provider with its enabled + configured (secret saved) state. */
  providers: ReadonlyArray<{ id: string; enabled: boolean; configured: boolean }>
  /** The unified workspace sign-in config — `authConfig.oauth`. */
  oauth: Record<string, boolean | undefined>
  /** Whether an outbound transport is wired (gates magic-link usability). */
  emailConfigured: boolean
  /** Social provider ids to consider (e.g. google, github). */
  socialIds: readonly string[]
  /** Social provider ids whose credentials are saved. */
  configuredSocialIds: ReadonlySet<string>
}

export interface SignInMethodSnapshot extends WorkingMethodInputs {
  /** The identity provider being removed or disabled. */
  targetIdpId: string
}

/**
 * Pure decision: does the workspace have AT LEAST ONE working sign-in method?
 * (a registered IdP, password, magic-link with email, or a social with creds).
 * Backs both the "is this the only method" guard and the built-in-disable
 * backstop.
 */
export function hasAnyWorkingSignInMethod(snap: WorkingMethodInputs): boolean {
  // Registered IdP — enabled + configured + tier on.
  if (snap.tierEnabled && snap.providers.some((p) => p.enabled && p.configured)) return true
  // Password — enabled (absent ⇒ on), matching the runtime gate.
  if (isSignInMethodEnabled(snap.oauth, 'password')) return true
  // Magic link — opt-in (absent ⇒ off) AND email delivery wired (else rejected).
  if (isSignInMethodEnabled(snap.oauth, 'magicLink') && snap.emailConfigured) return true
  // Social — opt-in (absent ⇒ off) AND its credentials are saved.
  for (const id of snap.socialIds) {
    if (isSignInMethodEnabled(snap.oauth, id) && snap.configuredSocialIds.has(id)) return true
  }
  return false
}

/**
 * Pure decision: is the workspace reachable ONLY through an identity provider?
 * True when at least one IdP works and no password, magic link, or social does.
 *
 * This is the second route to SSO-only, and it used to be the unguarded one.
 * Per-domain enforcement demands a break-glass recovery code before it will
 * turn on, but turning off password + magic link on the sign-in methods tab
 * reaches the same end state and was gated only by "at least one method
 * survives". A provider whose email addresses are placeholders can never pass
 * domain verification, so this path is the ONLY way such a workspace becomes
 * SSO-only — which made it exactly the wrong one to leave unguarded.
 */
export function isSsoOnlySignIn(snap: WorkingMethodInputs): boolean {
  const anyProviderWorks = snap.tierEnabled && snap.providers.some((p) => p.enabled && p.configured)
  if (!anyProviderWorks) return false

  // Take the providers out of the picture — matching how isOnlyWorkingSignInMethod
  // below drops just its target — and ask whether anything else is still a way in.
  return !hasAnyWorkingSignInMethod({ ...snap, providers: [] })
}

/**
 * Pure decision: is the target identity provider the workspace's ONLY working
 * sign-in method? True only when it's working and nothing else is — so removing
 * or disabling it would lock the workspace out.
 */
export function isOnlyWorkingSignInMethod(snap: SignInMethodSnapshot): boolean {
  const target = snap.providers.find((p) => p.id === snap.targetIdpId)
  // Not a working method (tier off, disabled, or no secret) → removing it can't
  // cause a lockout. Tier gates every IdP, mirroring `getRegisteredOidcProviderIds`.
  if (!snap.tierEnabled || !target?.enabled || !target.configured) return false

  // It IS working — so it's the only method iff nothing else works once it's gone.
  return !hasAnyWorkingSignInMethod({
    ...snap,
    providers: snap.providers.filter((p) => p.id !== snap.targetIdpId),
  })
}

/**
 * Gather the live {@link WorkingMethodInputs} from the DB / settings layers,
 * with the given `oauth` config. Server-only; dynamic imports keep the pure
 * functions above importable from a test without pulling in those layers.
 */
async function gatherWorkingMethodInputs(
  oauth: Record<string, boolean | undefined>,
  knownProviders?: IdentityProvider[]
): Promise<WorkingMethodInputs> {
  const { getConfiguredIntegrationTypes } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')
  const { listIdentityProviders } =
    await import('@/lib/server/domains/settings/identity-providers.service')
  const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
  const { isEmailConfigured } = await import('@quackback/email')
  const { AUTH_PROVIDERS } = await import('@/lib/server/auth/auth-providers')

  const [configuredTypes, providers, tierLimits] = await Promise.all([
    getConfiguredIntegrationTypes(),
    knownProviders ?? listIdentityProviders(),
    getTierLimits(),
  ])

  const socials = AUTH_PROVIDERS.filter((p) => p.type !== 'generic-oauth')
  return {
    tierEnabled: tierLimits.features.customOidcProvider,
    providers: providers.map((p) => ({ id: p.id, enabled: p.enabled, configured: p.configured })),
    oauth,
    emailConfigured: isEmailConfigured(),
    socialIds: socials.map((p) => p.id),
    configuredSocialIds: new Set(
      socials.filter((p) => configuredTypes.has(p.credentialType)).map((p) => p.id)
    ),
  }
}

/** Server entry point for {@link isOnlyWorkingSignInMethod} — gathers the live
 *  snapshot (current `authConfig.oauth`) and applies the pure check. */
export async function checkIsOnlyWorkingSignInMethod(
  targetIdpId: IdentityProviderId,
  /** Pre-loaded provider list to reuse when the caller already has it
   *  (e.g. the upsert path), avoiding a second `listIdentityProviders()`. */
  knownProviders?: IdentityProvider[]
): Promise<boolean> {
  const { getWorkspaceSettings } = await import('@/lib/server/domains/settings/settings.service')
  const workspace = await getWorkspaceSettings()
  const inputs = await gatherWorkingMethodInputs(
    (workspace?.authConfig?.oauth ?? {}) as Record<string, boolean | undefined>,
    knownProviders
  )
  return isOnlyWorkingSignInMethod({ ...inputs, targetIdpId })
}

/**
 * Would applying `proposedOauth` (the merged result of a built-in/social config
 * change) leave the workspace with NO working sign-in method? Backs the
 * server-side backstop on `updateAuthConfigFn` — a direct API call must not be
 * able to disable the last way in.
 */
export async function wouldLeaveNoWorkingSignInMethod(
  proposedOauth: Record<string, boolean | undefined>
): Promise<boolean> {
  const inputs = await gatherWorkingMethodInputs(proposedOauth)
  return !hasAnyWorkingSignInMethod(inputs)
}

/**
 * Both sign-in-method verdicts for a proposed config, from ONE snapshot.
 *
 * The auth-config save needs both, and `gatherWorkingMethodInputs` runs an
 * uncached `listIdentityProviders()` — two full-table reads — so asking the two
 * questions separately doubled that on the normal save path for no reason.
 */
export async function evaluateProposedSignInMethods(
  proposedOauth: Record<string, boolean | undefined>
): Promise<{ leavesNoMethod: boolean; leavesSsoOnly: boolean }> {
  const inputs = await gatherWorkingMethodInputs(proposedOauth)
  return {
    leavesNoMethod: !hasAnyWorkingSignInMethod(inputs),
    leavesSsoOnly: isSsoOnlySignIn(inputs),
  }
}

/**
 * THE break-glass precondition for reaching an SSO-only workspace, shared by
 * both routes that can get there: per-domain enforcement and the sign-in
 * methods save. Throws when no active recovery code exists.
 *
 * Deliberately one function rather than a copied check. Two implementations of
 * one rule in two code paths is the failure this branch exists to remove, and
 * a duplicate here would drift the same way.
 */
export async function assertBreakGlassAvailable(): Promise<void> {
  const { hasActiveRecoveryCodes } = await import('@/lib/server/auth/recovery-codes-status')
  if (!(await hasActiveRecoveryCodes())) {
    const { ForbiddenError } = await import('@/lib/shared/errors')
    throw new ForbiddenError('RECOVERY_CODES_REQUIRED', 'recovery_codes_required')
  }
}
