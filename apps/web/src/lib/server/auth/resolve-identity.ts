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

/** Sources in the order they are consulted. */
export type IdentitySource = 'idToken' | 'userinfo' | 'accessTokenJwt'

const DEFAULT_SOURCES: IdentitySource[] = ['idToken', 'userinfo']

export interface IdentityMapping {
  /** Defaults to ID token then userinfo. `accessTokenJwt` is opt-in. */
  sources?: IdentitySource[]
  idClaim?: string
  nameClaim?: string
  emailClaim?: string
}

export interface ResolvedIdentity {
  id: string
  email?: string
  name?: string
  emailVerified: boolean
  /** Which source supplied each field, for the test's provenance report. */
  sources: Partial<Record<'id' | 'email' | 'name', IdentitySource>>
  /** Every raw claim seen, earlier sources winning. Spread into the profile by
   *  the caller so `mapProfileToUser` still sees what it always did. */
  claims: Record<string, unknown>
}

export type ResolveFailure = 'subject_mismatch' | 'no_identity'

export type ResolveResult =
  | { ok: true; identity: ResolvedIdentity }
  | { ok: false; reason: ResolveFailure; claims: Record<string, unknown> }

export interface ResolveIdentityArgs {
  tokens: { idToken?: string; accessToken?: string }
  /** Fetches the userinfo document, or null when there is nowhere to fetch
   *  from. Injected so the resolver stays pure and testable. */
  fetchUserInfo: () => Promise<Record<string, unknown> | null>
  mapping?: IdentityMapping
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

/** Only literal `true` or the string "true" counts. A bridge emitting the
 *  string "false" is truthy, which is how an unverified address once marked an
 *  account verified. */
function isAffirmative(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.toLowerCase() === 'true')
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

export async function resolveIdentity({
  tokens,
  fetchUserInfo,
  mapping,
}: ResolveIdentityArgs): Promise<ResolveResult> {
  const idClaim = mapping?.idClaim ?? 'sub'
  const nameClaim = mapping?.nameClaim ?? 'name'
  const emailClaim = mapping?.emailClaim ?? 'email'
  const sources = mapping?.sources ?? DEFAULT_SOURCES

  const merged: Record<string, unknown> = {}
  const found: ResolvedIdentity['sources'] = {}
  let id: string | undefined
  let email: string | undefined
  let name: string | undefined
  let emailVerified = false

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
    // Fast path: stop before any network call once everything is resolved, so
    // a compliant provider takes no added latency from the cascade existing.
    if (id && email && name) break

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
    // token's must be discarded entirely. Scoped to userinfo deliberately —
    // an access token is audience-scoped, and with pairwise subjects the same
    // person legitimately carries a different one there.
    if (source === 'userinfo' && id && claimedId && claimedId !== id) {
      return { ok: false, reason: 'subject_mismatch', claims: merged }
    }

    // Earlier sources win: only fill what is still absent.
    for (const [key, value] of Object.entries(claims)) {
      if (!(key in merged)) merged[key] = value
    }

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
        emailVerified = isAffirmative(resolveClaim(claims, 'email_verified'))
      }
    }
  }

  if (!id) return { ok: false, reason: 'no_identity', claims: merged }

  return {
    ok: true,
    identity: { id, email, name, emailVerified, sources: found, claims: merged },
  }
}
