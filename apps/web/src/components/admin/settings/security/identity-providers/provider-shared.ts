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
import {
  DEFAULT_IDENTITY_SOURCES,
  IDENTITY_SOURCES,
  type IdentityProviderClaimMapping,
  type IdentitySource,
} from '@/lib/shared/oidc-claim-mapping'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import type { IdpKind } from '../idp-shortcuts'
import { sourcesAreDefault } from '@/lib/shared/sso-claim-mapping-edit'

export const OIDC_PROFILE_DEFAULTS = {
  id: 'sub',
  email: 'email',
  name: 'name',
} as const

export const PROFILE_FIELDS = ['id', 'email', 'name'] as const
export type ProfileFieldKey = (typeof PROFILE_FIELDS)[number]

export const PROFILE_ROW_LABELS: Record<ProfileFieldKey, string> = {
  id: 'Account ID',
  email: 'Email',
  name: 'Name',
}

/** Shown only in the edit dialog, where the choice is being made. The table
 *  itself carries no per-row explanation. */
export const PROFILE_DIALOG_HELPERS: Record<ProfileFieldKey, string> = {
  id: 'Matches accounts on every sign-in. Choose a stable, unique value.',
  email: 'Set when the account is created.',
  name: 'Set when the account is created. If missing, a name is generated from a username or the account ID.',
}

export const PEOPLE_TYPE_LABEL: Record<string, string> = {
  string: 'Text',
  number: 'Number',
  boolean: 'Boolean',
  date: 'Date',
  currency: 'Currency',
}

export const SOURCE_LABELS: Record<IdentitySource, string> = {
  idToken: 'ID token',
  userinfo: 'Userinfo',
  accessTokenJwt: 'Access-token JWT',
}

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
 * `role`, `attributes`). The mapping card now edits all three, but persist is
 * ops-based so unknown siblings survive. A card that rebuilt the whole object
 * would still drop whatever it does not render, so sections are patched, never
 * rebuilt.
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
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function blankSupportedPath(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.trim() === ''
}

export function identityMappingIssue(
  claimMapping: IdentityProviderClaimMapping | null | undefined
): string | null {
  if (!claimMapping) return null
  const profile = claimMapping.profile
  if (profile && isRecord(profile)) {
    const claims = isRecord(profile.claims) ? profile.claims : null
    if (claims) {
      if (blankSupportedPath(claims.id)) return 'Account ID mapping has no claim path'
      if (blankSupportedPath(claims.email)) return 'Email mapping has no claim path'
      if (blankSupportedPath(claims.name)) return 'Name mapping has no claim path'
    }
    if (Array.isArray(profile.sources)) {
      const kept = profile.sources.filter((s) =>
        (IDENTITY_SOURCES as readonly string[]).includes(s as string)
      )
      if (profile.sources.length > 0 && kept.length === 0) {
        return 'Identity sources are not valid'
      }
    }
  }
  const role = claimMapping.role
  if (!role) return null
  if (role.rules.some((r) => r.whenContains.trim() === '')) return 'A role rule has no value'
  if (role.claimPath.trim() === '') return 'Role mapping has no claim path'
  if (role.rules.length === 0 && role.syncOnEverySignIn === true) {
    return 'Role sync is on with no rules'
  }
  return null
}

/**
 * Drop display-only OIDC defaults so an untouched table Save does not persist
 * `profile`. Explicit `id: 'sub'` is kept because it disables userinfo `id`
 * fallback.
 */
export function normalizeProfileClaims(
  profile: IdentityProviderClaimMapping['profile'] | undefined
): IdentityProviderClaimMapping['profile'] | undefined {
  if (!profile) return undefined
  const next: NonNullable<IdentityProviderClaimMapping['profile']> = {}
  if (profile.allowMissingEmail === true) next.allowMissingEmail = true
  if (profile.sources && !sourcesAreDefault(profile.sources)) {
    const sources = profile.sources.filter((s) =>
      (IDENTITY_SOURCES as readonly string[]).includes(s)
    )
    if (sources.length > 0) next.sources = sources
  }
  const claims: NonNullable<NonNullable<IdentityProviderClaimMapping['profile']>['claims']> = {}
  const rawClaims = profile.claims ?? {}
  const id = typeof rawClaims.id === 'string' ? rawClaims.id.trim() : ''
  const email = typeof rawClaims.email === 'string' ? rawClaims.email.trim() : ''
  const name = typeof rawClaims.name === 'string' ? rawClaims.name.trim() : ''
  if (id) claims.id = id
  if (email && email !== OIDC_PROFILE_DEFAULTS.email) claims.email = email
  if (name && name !== OIDC_PROFILE_DEFAULTS.name) claims.name = name
  if (Object.keys(claims).length > 0) next.claims = claims
  return Object.keys(next).length > 0 ? next : undefined
}

export function hasCustomProfileClaims(
  mapping: IdentityProviderClaimMapping | null | undefined
): boolean {
  const claims = mapping?.profile?.claims
  if (!claims) return false
  if (claims.id !== undefined && String(claims.id).trim() !== '') return true
  const email = typeof claims.email === 'string' ? claims.email.trim() : ''
  const name = typeof claims.name === 'string' ? claims.name.trim() : ''
  return (
    (email !== '' && email !== OIDC_PROFILE_DEFAULTS.email) ||
    (name !== '' && name !== OIDC_PROFILE_DEFAULTS.name)
  )
}

/** Profile claim keys beyond id / email / name: legacy or forward-compatible
 *  entries this UI cannot edit but must keep showing so they are not
 *  mistaken for a standard mapping. */
export function extraProfileClaimKeys(
  mapping: IdentityProviderClaimMapping | null | undefined
): string[] {
  const claims = mapping?.profile?.claims
  if (!claims) return []
  return Object.keys(claims).filter((key) => key !== 'id' && key !== 'email' && key !== 'name')
}

export type PeopleDefinition = { key: string; label: string; type: string }

export type ClaimsProfileRow = {
  kind: 'profile'
  field: ProfileFieldKey
  label: string
  path: string
  isDefault: boolean
}

export type ClaimsRoleRow = {
  kind: 'role'
  claimPath: string
  rules: Array<{ whenContains: string; role: Role }>
  syncOnEverySignIn: boolean
}

export type ClaimsPeopleRow = {
  kind: 'people'
  baselineIndex: number
  claimPath: string
  attributeKey: string
  label: string
  typeLabel: string | null
  orphaned: boolean
  duplicate: boolean
}

export type ClaimsUnsupportedRow = {
  kind: 'unsupported'
  id: string
  label: string
  detail: string
}

export type ClaimsTableRow =
  ClaimsProfileRow | ClaimsRoleRow | ClaimsPeopleRow | ClaimsUnsupportedRow

export type AddClaimTarget =
  { kind: 'role' } | { kind: 'people'; key: string; label: string; attrType: string }

function profilePath(
  mapping: IdentityProviderClaimMapping | null | undefined,
  field: 'id' | 'email' | 'name'
): string | undefined {
  const value = mapping?.profile?.claims?.[field]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * The three profile fields, always present. Account ID is "custom" whenever a
 * path is stored — even an explicit `sub` — because an explicit path disables
 * the userinfo `id` compatibility fallback. Email and name are custom only
 * when the stored path differs from the standard claim.
 */
export function buildProfileRows(
  mapping: IdentityProviderClaimMapping | null | undefined
): ClaimsProfileRow[] {
  return PROFILE_FIELDS.map((field) => {
    const path = profilePath(mapping, field)
    return {
      kind: 'profile',
      field,
      label: PROFILE_ROW_LABELS[field],
      path: path ?? OIDC_PROFILE_DEFAULTS[field],
      isDefault:
        field === 'id'
          ? path === undefined
          : path === undefined || path === OIDC_PROFILE_DEFAULTS[field],
    }
  })
}

export function buildClaimsTableModel({
  mapping,
  definitions,
}: {
  mapping: IdentityProviderClaimMapping | null | undefined
  definitions: PeopleDefinition[]
}): { profile: ClaimsProfileRow[]; additional: ClaimsTableRow[] } {
  const profile = buildProfileRows(mapping)
  const additional: ClaimsTableRow[] = []
  const role = mapping?.role
  if (role && (role.claimPath || (role.rules?.length ?? 0) > 0 || role.syncOnEverySignIn)) {
    additional.push({
      kind: 'role',
      claimPath: role.claimPath || 'groups',
      rules: role.rules ?? [],
      syncOnEverySignIn: role.syncOnEverySignIn === true,
    })
  }
  const defByKey = new Map(definitions.map((d) => [d.key, d]))
  const map = mapping?.attributes?.map ?? []
  const keyCounts = new Map<string, number>()
  for (const row of map) {
    if (row.attributeKey)
      keyCounts.set(row.attributeKey, (keyCounts.get(row.attributeKey) ?? 0) + 1)
  }
  map.forEach((row, baselineIndex) => {
    const def = defByKey.get(row.attributeKey)
    additional.push({
      kind: 'people',
      baselineIndex,
      claimPath: row.claimPath,
      attributeKey: row.attributeKey,
      label: def?.label ?? row.attributeKey,
      typeLabel: def ? (PEOPLE_TYPE_LABEL[def.type] ?? def.type) : null,
      orphaned: Boolean(row.attributeKey) && !def,
      duplicate: Boolean(row.attributeKey) && (keyCounts.get(row.attributeKey) ?? 0) > 1,
    })
  })
  for (const key of extraProfileClaimKeys(mapping)) {
    additional.push({
      kind: 'unsupported',
      id: `profile.claims.${key}`,
      label: key,
      detail: 'Stored on this provider and not editable here. Saving other rows keeps it.',
    })
  }
  return { profile, additional }
}

/**
 * Whether the provider reads identity from a non-standard source list. Shown
 * as a compatibility exception; the controls live under Customize.
 */
export function hasCustomSources(
  mapping: IdentityProviderClaimMapping | null | undefined
): boolean {
  return !sourcesAreDefault(mapping?.profile?.sources)
}

/** The number of things User details shows beyond the standard profile. */
export function userDetailsAreStandard(
  mapping: IdentityProviderClaimMapping | null | undefined
): boolean {
  if (hasCustomProfileClaims(mapping)) return false
  if (extraProfileClaimKeys(mapping).length > 0) return false
  if (mapping?.role) return false
  if ((mapping?.attributes?.map?.length ?? 0) > 0) return false
  if (hasCustomSources(mapping)) return false
  return true
}

export function availableAddTargets({
  mapping,
  definitions,
}: {
  mapping: IdentityProviderClaimMapping | null | undefined
  definitions: PeopleDefinition[]
}): AddClaimTarget[] {
  const targets: AddClaimTarget[] = []
  const hasRole = Boolean(
    mapping?.role &&
    (mapping.role.claimPath ||
      (mapping.role.rules?.length ?? 0) > 0 ||
      mapping.role.syncOnEverySignIn)
  )
  if (!hasRole) targets.push({ kind: 'role' })
  const used = new Set(
    (mapping?.attributes?.map ?? []).map((row) => row.attributeKey).filter(Boolean)
  )
  for (const def of definitions) {
    if (used.has(def.key)) continue
    targets.push({ kind: 'people', key: def.key, label: def.label, attrType: def.type })
  }
  return targets
}

export function draftSources(
  mapping: IdentityProviderClaimMapping | null | undefined
): IdentitySource[] {
  const sources = mapping?.profile?.sources
  if (sources && sources.length > 0) return sources
  return [...DEFAULT_IDENTITY_SOURCES]
}

/**
 * Guard the fields a provider cannot be saved without. The create page checks
 * both; on the detail page the connection form owns the client ID and the
 * sign-in appearance form owns the display name, so each passes only what it
 * renders.
 *
 * Returns true when the caller should stop. The offending input is scrolled
 * to and focused because the forms are long enough for the field to be
 * off-screen when the toast fires.
 */
export function reportMissingIdpFields(fields: { label?: string; clientId?: string }): boolean {
  const missing =
    fields.clientId !== undefined && !fields.clientId.trim()
      ? 'idp-client-id'
      : fields.label !== undefined && !fields.label.trim()
        ? 'idp-label'
        : null
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
