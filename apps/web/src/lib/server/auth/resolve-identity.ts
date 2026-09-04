/**
 * THE identity resolver. One implementation, shared by production sign-in and
 * the admin connection test.
 *
 * Those two paths were previously separate implementations that disagreed:
 * sign-in accepted the ID token only when it carried both a subject and an
 * email and otherwise fell back to userinfo wholesale, while the test demanded
 * an email inside a signature-verified ID token and treated its own userinfo
 * call as informational. A provider releasing the address at userinfo therefore
 * signed users in successfully while failing the test that gates enforcement.
 * Collapsing them removes that entire class of bug.
 *
 * The cascade is ordered and gap-filling: each source contributes only fields
 * still missing, and an earlier source is never overwritten. That is strictly
 * more capable than all-or-nothing resolution — it can take the subject from
 * the ID token and the address from userinfo, which no previous path could.
 */

import { decodeJwt } from 'jose'
import { getClaimByPath, isAffirmativeClaim } from '@/lib/shared/oidc-claim-mapping'

/** Sources in the order they are consulted. */
export type IdentitySource = 'idToken' | 'userinfo' | 'accessTokenJwt'

const DEFAULT_SOURCES: IdentitySource[] = ['idToken', 'userinfo']

export interface IdentityMapping {
  /** Defaults to ID token then userinfo. `accessTokenJwt` is opt-in. */
  sources?: IdentitySource[]
  idClaim?: string
  nameClaim?: string
  emailClaim?: string
  /** Claim holding the avatar URL. Defaults to the OIDC-standard `picture`. */
  imageClaim?: string
}

export interface ResolvedIdentity {
  id: string
  email?: string
  name?: string
  /** Avatar URL, resolved only when `wantImage` is set. Always an absolute
   *  `http(s)` URL (see {@link pickAvatarUrl}); `undefined` otherwise. */
  image?: string
  emailVerified: boolean
  /** Which source supplied each field, for the test's provenance report. */
  sources: Partial<Record<'id' | 'email' | 'name' | 'image', IdentitySource>>
  /** Every raw claim seen, earlier sources winning. Spread into the profile by
   *  the caller so `mapProfileToUser` still sees what it always did. */
  claims: Record<string, unknown>
  /** Discrepancies observed but not treated as fatal. */
  warnings?: ResolveWarning[]
}

export type ResolveFailure = 'subject_mismatch' | 'no_identity'

/** Non-fatal discrepancies worth surfacing and counting. */
export type ResolveWarning = 'subject_mismatch'

export type ResolveResult =
  | { ok: true; identity: ResolvedIdentity }
  | { ok: false; reason: ResolveFailure; claims: Record<string, unknown> }

export interface ResolveIdentityArgs {
  tokens: { idToken?: string; accessToken?: string }
  /** Fetches the userinfo document, or null when there is nowhere to fetch
   *  from. Injected so the resolver stays pure and testable. */
  fetchUserInfo: () => Promise<Record<string, unknown> | null>
  mapping?: IdentityMapping
  /**
   * What to do when userinfo reports a different subject from the ID token.
   * Defaults to observing, so the release that introduces the check does not
   * also break every provider currently relying on the old behaviour.
   */
  subjectMismatch?: 'observe' | 'enforce'
  /**
   * Extra claim paths that must be present in `merged` before the fast path
   * may skip remaining sources. Production passes mapped attribute and role
   * paths so a complete ID token still fetches userinfo when those claims
   * live only there.
   */
  requiredClaimPaths?: string[]
  /**
   * Walk every configured source even when identity (and required paths) are
   * already complete. The connection test uses this so the capture shows
   * everything the IdP can release.
   */
  exhaustive?: boolean
  /**
   * Also resolve `identity.image` from the `picture` claim (or
   * `mapping.imageClaim`). Off by default so the fast path still stops before
   * userinfo once id + email + name are in hand; when on, the cascade keeps
   * going to a later source for the avatar, which is where a `picture` claim
   * usually lives for providers that don't put it in the ID token.
   */
  wantImage?: boolean
}

/**
 * Resolve a claim path. An exact key match is tried first so namespaced claims
 * like `https://acme.com/email`, whose dots are not separators, still work.
 */
function resolveClaim(claims: Record<string, unknown>, path: string): unknown {
  if (path in claims) return claims[path]
  let current: unknown = claims
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** Decode a JWT payload without verifying it. Possession is the trust anchor:
 *  the token came first-hand from the token endpoint over TLS. */
function decodePayload(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null
  try {
    const payload = decodeJwt(token)
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

/** Same missing-value rule as `planClaimAttributeWrites`. */
function claimIsMissing(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function requiredPathsResolved(
  merged: Record<string, unknown>,
  paths: string[] | undefined
): boolean {
  if (!paths?.length) return true
  return paths.every((path) => !claimIsMissing(getClaimByPath(merged, path)))
}

/** Segments that would walk onto or rewrite a prototype rather than a claim. */
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Write a leaf onto `claims` without replacing an already-present parent
 * object. Used to gap-fill required nested paths (e.g. `org.costCenter`)
 * after the shallow earlier-source-wins merge has already taken `org`.
 *
 * The path is admin-configured, so a segment like `__proto__` is refused
 * outright rather than followed: `current['__proto__']` is `Object.prototype`,
 * and assigning the leaf there would pollute every object in the process.
 */
function setClaimByPath(claims: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.')
  if (segments.some((segment) => UNSAFE_SEGMENTS.has(segment))) return
  if (Object.hasOwn(claims, path) || path.includes('://') || segments.length === 1) {
    claims[path] = value
    return
  }
  let current: Record<string, unknown> = claims
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]
    const next = Object.hasOwn(current, segment) ? current[segment] : undefined
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }
  current[segments[segments.length - 1]] = value
}

function fillRequiredLeaves(
  merged: Record<string, unknown>,
  source: Record<string, unknown>,
  paths: string[] | undefined
): void {
  if (!paths?.length) return
  for (const path of paths) {
    if (!claimIsMissing(getClaimByPath(merged, path))) continue
    const incoming = getClaimByPath(source, path)
    if (claimIsMissing(incoming)) continue
    setClaimByPath(merged, path, incoming)
  }
}

/**
 * A trimmed absolute `http(s)` URL, or `undefined`. The value is stored verbatim
 * and later rendered as an `<img src>`, so a relative path or a `data:` /
 * `javascript:` string must not pass.
 */
function asHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : undefined
  } catch {
    return undefined
  }
}

/**
 * The avatar URL to adopt for an OIDC account, read from the OIDC Core `picture`
 * claim (`userinfo` or the ID token — `claims` here is already the merged set).
 *
 * Better-Auth's genericOAuth only maps `userInfo.image` to `user.image`, never
 * `picture`, so without this a fully compliant provider produces no avatar.
 * Kept standalone so it is unit-testable without the resolver, and reused by the
 * after-callback avatar backfill.
 */
export function pickAvatarUrl(claims: Record<string, unknown>): string | undefined {
  return asHttpUrl(claims.picture)
}

export async function resolveIdentity({
  tokens,
  fetchUserInfo,
  mapping,
  subjectMismatch = 'observe',
  requiredClaimPaths,
  exhaustive = false,
  wantImage = false,
}: ResolveIdentityArgs): Promise<ResolveResult> {
  const idClaim = mapping?.idClaim ?? 'sub'
  const nameClaim = mapping?.nameClaim ?? 'name'
  const emailClaim = mapping?.emailClaim ?? 'email'
  const imageClaim = mapping?.imageClaim ?? 'picture'
  const sources = mapping?.sources ?? DEFAULT_SOURCES

  const merged: Record<string, unknown> = {}
  const found: ResolvedIdentity['sources'] = {}
  let id: string | undefined
  let email: string | undefined
  let name: string | undefined
  let image: string | undefined
  let emailVerified = false
  const warnings: ResolveWarning[] = []

  const loadSource = async (source: IdentitySource): Promise<Record<string, unknown> | null> => {
    if (source === 'idToken') return decodePayload(tokens.idToken)
    if (source === 'accessTokenJwt') return decodePayload(tokens.accessToken)
    try {
      return await fetchUserInfo()
    } catch {
      return null
    }
  }

  for (const source of sources) {
    // Fast path: stop before any network call once identity is complete and
    // every mapped claim is already in `merged`. With `wantImage`, keep going
    // for the avatar too — its claim commonly lives only at userinfo, past
    // where id + email + name already stopped us. `exhaustive` disables this
    // so the connection test walks every source.
    const identityComplete = Boolean(id && email && name)
    if (
      !exhaustive &&
      identityComplete &&
      (!wantImage || image) &&
      requiredPathsResolved(merged, requiredClaimPaths)
    ) {
      break
    }

    const claims = await loadSource(source)
    if (!claims) continue

    // Reproduce the library's own derivation exactly, or an upgrade re-keys
    // existing accounts: lookup matches the account identifier first, so a
    // changed value misses, the email fallback finds the user, and a second
    // account row appears — or, with no email, the user forks. The `id`
    // fallback is userinfo-only because that is where the library applies it;
    // its ID-token path keys on `sub` alone. An explicit idClaim wins over both.
    const claimedId =
      asNonEmptyString(resolveClaim(claims, idClaim)) ??
      (source === 'userinfo' && !mapping?.idClaim
        ? asNonEmptyString(resolveClaim(claims, 'id'))
        : undefined)

    // OIDC Core 5.3.2: a userinfo response whose subject differs from the ID
    // token's must be discarded. Scoped to userinfo deliberately — an access
    // token is audience-scoped, and with pairwise subjects the same person
    // legitimately carries a different one there.
    //
    // Observed rather than enforced by default. A provider in this state works
    // TODAY, because the path being replaced discards the ID token and takes
    // userinfo wholesale; enforcing on the same release as the cascade would
    // make that a total sign-in outage on an upgrade nobody chose, with no
    // telemetry to size it first. So the default reproduces today's behaviour
    // and reports the discrepancy, and a later release flips to enforcing.
    if (source === 'userinfo' && id && claimedId && claimedId !== id) {
      if (subjectMismatch === 'enforce') {
        return { ok: false, reason: 'subject_mismatch', claims: merged }
      }
      warnings.push('subject_mismatch')
      // The legacy re-key below only ever applied when the ID token was
      // INCOMPLETE, because a complete one never reached userinfo. When this
      // fetch happened solely for a mapped claim path, the avatar, or the
      // exhaustive test walk, the account is already keyed by the ID token and
      // must stay so: enabling a mapping cannot be what links a different account.
      // Per OIDC Core 5.3.2 the mismatched response is discarded outright.
      if (identityComplete) continue
      // Legacy behaviour: userinfo wins wholesale, which means its subject is
      // what keys the account. Anything already taken from the ID token is
      // cleared so the two are never mixed.
      id = undefined
      email = undefined
      name = undefined
      image = undefined
      emailVerified = false
      found.id = undefined
      found.email = undefined
      found.name = undefined
      found.image = undefined
    }

    // Earlier sources win: only fill what is still absent.
    for (const [key, value] of Object.entries(claims)) {
      if (!(key in merged)) merged[key] = value
    }
    // Nested required paths are not covered by the shallow merge: an ID token
    // `org` object without `costCenter` would otherwise block userinfo's
    // `org.costCenter`. Fill those leaves without rewriting earlier keys.
    fillRequiredLeaves(merged, claims, requiredClaimPaths)

    if (!id && claimedId) {
      id = claimedId
      found.id = source
    }
    if (!name) {
      const claimedName = asNonEmptyString(resolveClaim(claims, nameClaim))
      if (claimedName) {
        name = claimedName
        found.name = source
      }
    }
    if (!email) {
      const claimedEmail = asNonEmptyString(resolveClaim(claims, emailClaim))
      if (claimedEmail) {
        email = claimedEmail
        found.email = source
        // The verified flag must come from the SAME source as the address; one
        // asserted in the ID token cannot vouch for a userinfo address.
        emailVerified = isAffirmativeClaim(resolveClaim(claims, 'email_verified'))
      }
    }
    if (wantImage && !image) {
      const claimedImage = asHttpUrl(resolveClaim(claims, imageClaim))
      if (claimedImage) {
        image = claimedImage
        found.image = source
      }
    }
  }

  if (!id) return { ok: false, reason: 'no_identity', claims: merged }

  return {
    ok: true,
    identity: {
      id,
      email,
      name,
      ...(image ? { image } : {}),
      emailVerified,
      sources: found,
      claims: merged,
      ...(warnings.length > 0 ? { warnings } : {}),
    },
  }
}
