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
 * Binding rules live in the shared source-aware binder. This module supplies
 * decoded tokens and lazy userinfo, then adapts the binder result.
 */

import { decodeJwt } from 'jose'
import {
  advanceBindingState,
  asHttpUrl,
  bindingComplete,
  createBindingState,
  finishBinding,
  type BindingState,
  type IdentityMapping,
} from '@/lib/shared/sso-claim-binder'
import type { IdentitySource, SourceUnavailableReason } from '@/lib/shared/oidc-claim-mapping'

export type { IdentitySource, IdentityMapping }

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

function decodeSource(
  token: string | undefined
): { claims: Record<string, unknown> } | { unavailable: SourceUnavailableReason } {
  if (!token) return { unavailable: 'absent' }
  const payload = decodePayload(token)
  return payload ? { claims: payload } : { unavailable: 'unreadable' }
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

function sourcesFrom(state: BindingState): ResolvedIdentity['sources'] {
  const sources: ResolvedIdentity['sources'] = {}
  if (state.provenance.id) sources.id = state.provenance.id.source
  if (state.provenance.email) sources.email = state.provenance.email.source
  if (state.provenance.name) sources.name = state.provenance.name.source
  if (state.provenance.image) sources.image = state.provenance.image.source
  return sources
}

function toResolveResult(state: BindingState): ResolveResult {
  const finished = finishBinding(state)
  if (finished.failed === 'subject_mismatch') {
    return { ok: false, reason: 'subject_mismatch', claims: finished.acceptedClaims }
  }
  if (!finished.identity.id) {
    return { ok: false, reason: 'no_identity', claims: finished.acceptedClaims }
  }
  return {
    ok: true,
    identity: {
      id: finished.identity.id,
      email: finished.identity.email,
      name: finished.identity.name,
      ...(finished.identity.image ? { image: finished.identity.image } : {}),
      emailVerified: finished.identity.emailVerified,
      sources: sourcesFrom(finished),
      claims: finished.acceptedClaims,
      ...(finished.warnings.length > 0 ? { warnings: finished.warnings } : {}),
    },
  }
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
  let state = createBindingState({
    mapping,
    requiredClaimPaths,
    wantImage,
    exhaustive,
    subjectMismatch,
  })

  const loadSource = async (
    source: IdentitySource
  ): Promise<{ claims: Record<string, unknown> } | { unavailable: SourceUnavailableReason }> => {
    if (source === 'idToken') return decodeSource(tokens.idToken)
    if (source === 'accessTokenJwt') return decodeSource(tokens.accessToken)
    try {
      const doc = await fetchUserInfo()
      return doc ? { claims: doc } : { unavailable: 'absent' }
    } catch {
      return { unavailable: 'fetch_failed' }
    }
  }

  for (const source of state.config.sources) {
    if (!state.config.exhaustive && bindingComplete(state)) break
    const loaded = await loadSource(source)
    if ('unavailable' in loaded) {
      state = advanceBindingState(state, source, null, loaded.unavailable)
      continue
    }
    state = advanceBindingState(state, source, loaded.claims)
    if (state.failed) break
  }

  return toResolveResult(state)
}
