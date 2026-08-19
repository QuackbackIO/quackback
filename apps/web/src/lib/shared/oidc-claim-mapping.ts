/**
 * THE claim-mapping reader. One provider row in, the meaning of its claims out,
 * read by production sign-in and by the admin connection test alike.
 *
 * It replaces `attribute_mapping`, which despite its name only ever mapped a
 * claim to a ROLE. Adding a second column for profile fields and a third for
 * user attributes would have left three overlapping mapping concepts on one
 * table, two of them misleadingly named — the same drift this area keeps
 * producing. So there is one column with named sections instead:
 *
 *   profile     which claim holds the account id, the email, the display name
 *   role        the former attribute_mapping, unchanged in behaviour
 *   attributes  claim to user-attribute copying
 *
 * Every accessor here tolerates a null, malformed, or partially-filled column.
 * A hand-edited row or a shape written by a newer version must degrade to "not
 * configured" and let the standard OIDC claims carry the sign-in, because the
 * alternative is throwing inside the auth callback.
 */

import type { Role } from './roles'

/** Where identity may be read from, in the order the resolver tries them. */
export const IDENTITY_SOURCES = ['idToken', 'userinfo', 'accessTokenJwt'] as const
export type IdentitySource = (typeof IDENTITY_SOURCES)[number]

/**
 * The id token first because it is the only source the provider signed, then
 * userinfo. The access token is deliberately absent: it is audience-scoped and
 * its subject may legitimately differ, so reading identity from it is opt-in.
 */
export const DEFAULT_IDENTITY_SOURCES: IdentitySource[] = ['idToken', 'userinfo']

/** Profile fields a claim can be bound to. */
export type ProfileField = 'id' | 'email' | 'name'

const KNOWN_ROLES: readonly string[] = ['admin', 'member', 'user']

export interface ClaimRoleMapping {
  /** Dotted path, or a URL-shaped namespaced claim used as a single key. */
  claimPath: string
  /** First-match-wins. */
  rules: Array<{ whenContains: string; role: Role }>
  /** Re-apply on every sign-in, so a role can be promoted or demoted. */
  syncOnEverySignIn?: boolean
}

export interface IdentityProviderClaimMapping {
  profile?: {
    sources?: IdentitySource[]
    claims?: Partial<Record<ProfileField, string>>
    /** Mint a placeholder address when the provider supplies no email. */
    allowMissingEmail?: boolean
  }
  role?: ClaimRoleMapping
  attributes?: {
    map?: Array<{ claimPath: string; attributeKey: string }>
    /** Off: a claim only fills an attribute that is empty. */
    overrideExisting?: boolean
    /** When true, a disappeared claim clears the stored attribute. */
    syncOnSignIn?: boolean
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A claim path is usable only if it has non-whitespace content. */
function usablePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readSources(value: unknown): IdentitySource[] | undefined {
  if (!Array.isArray(value)) return undefined
  const kept = value.filter((s): s is IdentitySource =>
    (IDENTITY_SOURCES as readonly unknown[]).includes(s)
  )
  return kept.length > 0 ? kept : undefined
}

function readProfile(value: unknown): IdentityProviderClaimMapping['profile'] {
  if (!isRecord(value)) return undefined
  const claims: Partial<Record<ProfileField, string>> = {}
  const rawClaims = isRecord(value.claims) ? value.claims : {}
  for (const field of ['id', 'email', 'name'] as const) {
    const path = usablePath(rawClaims[field])
    if (path) claims[field] = path
  }
  const profile: NonNullable<IdentityProviderClaimMapping['profile']> = {}
  const sources = readSources(value.sources)
  if (sources) profile.sources = sources
  if (Object.keys(claims).length > 0) profile.claims = claims
  // Strictly `true`. A truthy string from a hand-edited row must not enable
  // one-way placeholder minting.
  if (value.allowMissingEmail === true) profile.allowMissingEmail = true
  return Object.keys(profile).length > 0 ? profile : undefined
}

function readRole(value: unknown): ClaimRoleMapping | undefined {
  if (!isRecord(value)) return undefined
  const claimPath = usablePath(value.claimPath)
  // Rules cannot be evaluated without a path. A half-configured mapping that
  // silently matches nothing is worse than no mapping, because the admin sees
  // configuration and gets default-role behaviour.
  if (!claimPath) return undefined
  const rules = Array.isArray(value.rules)
    ? value.rules.filter(
        (r): r is { whenContains: string; role: Role } =>
          isRecord(r) &&
          typeof r.whenContains === 'string' &&
          KNOWN_ROLES.includes(r.role as string)
      )
    : []
  const role: ClaimRoleMapping = { claimPath, rules }
  if (value.syncOnEverySignIn === true) role.syncOnEverySignIn = true
  return role
}

function readAttributes(value: unknown): IdentityProviderClaimMapping['attributes'] {
  if (!isRecord(value)) return undefined
  const map = Array.isArray(value.map)
    ? value.map.flatMap((entry) => {
        if (!isRecord(entry)) return []
        const claimPath = usablePath(entry.claimPath)
        const attributeKey = usablePath(entry.attributeKey)
        return claimPath && attributeKey ? [{ claimPath, attributeKey }] : []
      })
    : []
  const attributes: NonNullable<IdentityProviderClaimMapping['attributes']> = {}
  if (map.length > 0) attributes.map = map
  if (value.overrideExisting === true) attributes.overrideExisting = true
  if (value.syncOnSignIn === true) attributes.syncOnSignIn = true
  return Object.keys(attributes).length > 0 ? attributes : undefined
}

/** Normalise the stored column into a shape the rest of the code can trust. */
export function claimMappingFor(stored: unknown): IdentityProviderClaimMapping {
  if (!isRecord(stored)) return {}
  const mapping: IdentityProviderClaimMapping = {}
  const profile = readProfile(stored.profile)
  if (profile) mapping.profile = profile
  const role = readRole(stored.role)
  if (role) mapping.role = role
  const attributes = readAttributes(stored.attributes)
  if (attributes) mapping.attributes = attributes
  return mapping
}

/** The claim path bound to a profile field, or undefined to use the standard one. */
export function profileClaimFor(stored: unknown, field: ProfileField): string | undefined {
  return claimMappingFor(stored).profile?.claims?.[field]
}

/** The role section, or undefined when the workspace has not configured one. */
export function roleMappingFor(stored: unknown): ClaimRoleMapping | undefined {
  return claimMappingFor(stored).role
}

/** Whether this provider may mint placeholder addresses. Off unless set. */
export function allowsMissingEmail(stored: unknown): boolean {
  return claimMappingFor(stored).profile?.allowMissingEmail === true
}

/** The sources to try, in order, for this provider. */
export function identitySourcesFor(stored: unknown): IdentitySource[] {
  return claimMappingFor(stored).profile?.sources ?? DEFAULT_IDENTITY_SOURCES
}

/**
 * Resolve a claim path. An exact key match is tried first so namespaced claims
 * like `https://acme.com/email`, whose dots are not separators, still work.
 */
export function getClaimByPath(claims: Record<string, unknown>, path: string): unknown {
  if (path in claims) return claims[path]
  let current: unknown = claims
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/**
 * Whether a boolean-ish claim says yes.
 *
 * Affirmative is literal `true` or the exact (case-insensitive) string
 * `"true"`, and nothing else. Accepting `"true"` keeps the SAML-to-OIDC bridges
 * that stringify their booleans working; refusing `1`, `"yes"` and friends
 * stops this drifting back into plain truthiness, where the string `"false"`
 * once marked an unverified address as verified.
 *
 * One implementation, because both readers of `email_verified` have to agree:
 * identity resolution decides whether an address can be trusted, and profile
 * mapping decides what gets written to the account.
 */
export function isAffirmativeClaim(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.toLowerCase() === 'true')
}
