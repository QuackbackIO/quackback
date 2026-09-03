/**
 * Shared vocabulary for the identity-provider pages.
 *
 * The editor used to be one dialog that saved everything at once, so these
 * helpers could live inline. Split across two routed pages and five
 * independently-saving cards, they are the things every card has to agree on:
 * which query cache to invalidate, how a redirect URI is built, when a
 * connection test still vouches for the current config, and — most
 * importantly — how one card writes its own slice of the shared
 * `claim_mapping` column without erasing the slices it does not render.
 */
import { toast } from 'sonner'
import type { Role } from '@/lib/shared/roles'
import type { IdentityProviderClaimMapping } from '@/lib/shared/oidc-claim-mapping'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import type { IdpKind } from '../idp-shortcuts'

export const IDENTITY_PROVIDERS_KEY = ['settings', 'identityProviders'] as const

/** Where both provider pages go "back" to: the Sign-in tab that lists them. */
export const SIGN_IN_TAB = {
  to: '/admin/settings/security/authentication',
  search: { tab: 'sign-in' as const },
} as const

export const IDP_KIND_OPTIONS: IdpKind[] = ['okta', 'auth0', 'entra', 'keycloak', 'google', 'other']

export const ROLES: Role[] = ['admin', 'member', 'user']

/** The role section of `claim_mapping` — the claim→role rules. */
export type RoleMapping = NonNullable<IdentityProviderClaimMapping['role']>

/** All OIDC providers register under the genericOAuth callback path. The
 *  admin copies this into their IdP's allowed-redirect list. */
export function redirectUriFor(baseUrl: string | undefined, registrationId: string): string {
  // Build from the SERVER's configured base URL (what Better-Auth actually uses
  // for the OAuth redirect_uri), not window.location.origin — those diverge
  // behind a proxy/tunnel (e.g. ngrok) and a mismatch breaks the OAuth flow.
  const origin = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '')
  return `${origin.replace(/\/+$/, '')}/api/auth/oauth2/callback/${registrationId}`
}

/** New providers get an `oidc_<id>` registrationId (stable across the
 *  migration; drives the redirect URI + `account.provider_id`). */
export function newRegistrationId(): string {
  return `oidc_${Math.random().toString(36).slice(2, 10)}`
}

/** Connection-test freshness from the provider's last successful test vs. its
 *  last redirect-affecting change. Drives the connection status line, the
 *  header pill, and the enforcement-unlock gate — only `verified` may turn
 *  enforcement on. Mirrors the server-side
 *  `isSsoEnforcementUnlocked(provider, null)` predicate. */
export type ConnectionTestState =
  { kind: 'unsaved' | 'untested' | 'stale' } | { kind: 'verified'; testedAt: string }

export function getConnectionTestState(provider: IdentityProvider | null): ConnectionTestState {
  if (!provider) return { kind: 'unsaved' }
  const testedMs = provider.lastSuccessfulTestAt
    ? new Date(provider.lastSuccessfulTestAt).getTime()
    : null
  if (testedMs === null || Number.isNaN(testedMs)) return { kind: 'untested' }
  const changedMs = provider.detailsChangedAt ? new Date(provider.detailsChangedAt).getTime() : null
  if (changedMs !== null && !Number.isNaN(changedMs) && testedMs <= changedMs) {
    return { kind: 'stale' }
  }
  return { kind: 'verified', testedAt: provider.lastSuccessfulTestAt! }
}

/**
 * Merge one section into a provider's stored `claim_mapping`, leaving every
 * other section exactly as it was found.
 *
 * `claim_mapping` is a single jsonb column with named sections (`profile`,
 * `role`, `attributes`) but the UI now writes it from two different cards, and
 * `attributes` has no UI at all. A card that rebuilt the whole object would
 * silently drop whatever it does not render — including the parts of `profile`
 * (`sources`, `claims`) that only the mapping reader knows about. So sections
 * are patched, never rebuilt.
 *
 * An empty section is dropped and an empty object becomes `null`, so a
 * provider with nothing configured persists as `null` rather than `{}` — the
 * canonical "not configured" state everywhere else in this column.
 */
export function mergeClaimMapping(
  current: IdentityProviderClaimMapping | null | undefined,
  patch: Partial<IdentityProviderClaimMapping>
): IdentityProviderClaimMapping | null {
  const next: IdentityProviderClaimMapping = { ...(current ?? {}), ...patch }
  if (!next.role) delete next.role
  if (!next.profile || Object.keys(next.profile).length === 0) delete next.profile
  if (!next.attributes || Object.keys(next.attributes).length === 0) delete next.attributes
  return Object.keys(next).length > 0 ? next : null
}

/**
 * Patch just `profile.allowMissingEmail`, keeping the rest of the profile
 * section (`sources`, `claims`) verbatim. Off writes no key at all: absent
 * means "not configured" everywhere else in this column, and an explicit
 * `false` would make an untouched provider look deliberately configured.
 */
export function withAllowMissingEmail(
  profile: IdentityProviderClaimMapping['profile'],
  allow: boolean
): IdentityProviderClaimMapping['profile'] {
  const rest = { ...(profile ?? {}) }
  delete rest.allowMissingEmail
  if (allow) return { ...rest, allowMissingEmail: true }
  return Object.keys(rest).length > 0 ? rest : undefined
}

/**
 * A role mapping with no rules and no sign-in sync does nothing, so it is
 * persisted as absent (the canonical "no mapping" state). A custom claim path
 * on its own is inert.
 */
/** The attributes section of `claim_mapping` — claim → person-attribute rows. */
export type AttributeMapping = NonNullable<IdentityProviderClaimMapping['attributes']>

/**
 * Drop rows with an empty path or key. Persist `undefined` when nothing
 * remains so `mergeClaimMapping` deletes the section. Flags are kept only
 * when at least one row survives.
 */
export function normalizeAttributeMapping(
  mapping: AttributeMapping | null | undefined
): AttributeMapping | undefined {
  if (!mapping) return undefined
  const map = (mapping.map ?? []).filter(
    (row) => row.claimPath.trim() !== '' && row.attributeKey.trim() !== ''
  )
  if (map.length === 0) return undefined
  const next: AttributeMapping = { map }
  if (mapping.overrideExisting === true) next.overrideExisting = true
  if (mapping.syncOnSignIn === true) next.syncOnSignIn = true
  return next
}

export function normalizeRoleMapping(mapping: RoleMapping | null): RoleMapping | undefined {
  if (!mapping) return undefined
  if (mapping.rules.length === 0 && mapping.syncOnEverySignIn !== true) return undefined
  return mapping
}

/**
 * A short reason the claim mapping will not do what it looks like it does, or
 * null when it is fine. Surfaced as a header pill because identity resolution
 * runs on every sign-in: a rule that can never match is indistinguishable from
 * a working one until someone cannot get the role they were promised.
 */
export function identityMappingIssue(
  claimMapping: IdentityProviderClaimMapping | null | undefined
): string | null {
  const role = claimMapping?.role
  if (!role) return null
  if (role.rules.some((r) => r.whenContains.trim() === '')) return 'A role rule has no value'
  if (role.claimPath.trim() === '') return 'Role mapping has no claim path'
  if (role.rules.length === 0 && role.syncOnEverySignIn === true) {
    return 'Role sync is on with no rules'
  }
  return null
}

/**
 * Guard the two fields a provider cannot be saved without, from either the
 * create page or the connection card.
 *
 * Returns true when the caller should stop. Both entry points edit the same
 * pair, so the rule and the way it is reported live here rather than being
 * copied — a new required field is then one edit, not two that can disagree.
 * The offending input is scrolled to and focused because both forms are long
 * enough for the field to be off-screen when the toast fires.
 */
export function reportMissingIdpFields(label: string, clientId: string): boolean {
  const missing = !label.trim() ? 'idp-label' : !clientId.trim() ? 'idp-client-id' : null
  if (!missing) return false
  toast.error(missing === 'idp-label' ? 'Display name is required.' : 'Client ID is required.')
  const field = document.getElementById(missing)
  field?.scrollIntoView({ block: 'center' })
  field?.focus()
  return true
}

/** This provider is the last thing standing between the workspace and a
 *  no-auth lockout when it's the sole enabled + configured sign-in method;
 *  turning it off (or removing it) must be blocked. */
export function isOnlyWorkingMethod(
  provider: { enabled: boolean; configured: boolean } | null | undefined,
  enabledMethodCount: number
): boolean {
  return enabledMethodCount === 1 && !!provider?.enabled && !!provider?.configured
}
