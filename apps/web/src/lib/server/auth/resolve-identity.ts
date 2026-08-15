/**
 * THE identity resolver. One implementation, shared by production sign-in and
 * the admin connection test.
 *
 * Identity fields (id / email / name) are gap-filling: an earlier source is
 * never overwritten. Every configured source is still loaded so later claims
 * (`groups`, custom attributes) reach the stash.
 */

import { decodeJwt } from 'jose'
import {
  DEFAULT_IDENTITY_SOURCES,
  getClaimByPath,
  isAffirmativeClaim,
  type IdentitySource,
} from '@/lib/shared/oidc-claim-mapping'

export type { IdentitySource }

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
  /** Every raw claim seen, earlier sources winning. */
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

export async function resolveIdentity({
  tokens,
  fetchUserInfo,
  mapping,
}: ResolveIdentityArgs): Promise<ResolveResult> {
  const idClaim = mapping?.idClaim ?? 'sub'
  const nameClaim = mapping?.nameClaim ?? 'name'
  const emailClaim = mapping?.emailClaim ?? 'email'
  const sources = mapping?.sources ?? DEFAULT_IDENTITY_SOURCES

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
    const claims = await loadSource(source)
    if (!claims) continue

    // Reproduce the library's own derivation: userinfo falls back to `id`
    // when `sub` is absent. An explicit idClaim wins over both.
    const claimedId =
      asNonEmptyString(getClaimByPath(claims, idClaim)) ??
      (source === 'userinfo' && !mapping?.idClaim
        ? asNonEmptyString(getClaimByPath(claims, 'id'))
        : undefined)

    // OIDC Core 5.3.2: a userinfo response whose subject differs from the
    // already-resolved id is never merged. Mixing them can attach the
    // wrong account, so sign-in is refused.
    if (source === 'userinfo' && id && claimedId && claimedId !== id) {
      return { ok: false, reason: 'subject_mismatch', claims: merged }
    }

    for (const [key, value] of Object.entries(claims)) {
      if (!(key in merged)) merged[key] = value
    }

    if (!id && claimedId) {
      id = claimedId
      found.id = source
    }
    if (!name) {
      const claimedName = asNonEmptyString(getClaimByPath(claims, nameClaim))
      if (claimedName) {
        name = claimedName
        found.name = source
      }
    }
    if (!email) {
      const claimedEmail = asNonEmptyString(getClaimByPath(claims, emailClaim))
      if (claimedEmail) {
        email = claimedEmail
        found.email = source
        emailVerified = isAffirmativeClaim(getClaimByPath(claims, 'email_verified'))
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
      emailVerified,
      sources: found,
      claims: merged,
    },
  }
}
