/**
 * Pure finalization of a bound identity: name synthesis, email normalisation,
 * and the missing-email / placeholder outcome. Random minting stays server-only.
 */

import type { JsonValue } from './json'
import type { BindingState, FieldProvenance, ResolveWarning } from './sso-claim-binder'

export type ProfileOutcomeKind =
  'identity' | 'missing_id' | 'missing_email' | 'placeholder_required'

export type ProfileOutcome = {
  kind: ProfileOutcomeKind
  id?: string
  email?: string
  name?: string
  nameSynthesized: boolean
  emailVerified: boolean
  placeholderEmail: boolean
  provenance: Partial<Record<'id' | 'email' | 'name' | 'image', FieldProvenance>>
  acceptedClaims: Record<string, JsonValue>
  warnings: readonly ResolveWarning[]
}

function usableClaim(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Turn a subject into something printable. Subjects are opaque and often
 * structured (`ACCOUNT:REGION:2119123456`), and some providers put an email
 * address there — which must not become a display name, because display names
 * are published on posts and comments.
 */
function readableFromSubject(subject: string): string {
  const withoutAddress = subject.includes('@') ? subject.split('@')[0] : subject
  const cleaned = withoutAddress
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[-\s]+|[-\s]+$/g, '')
    .slice(0, 60)
  return cleaned || 'Member'
}

/**
 * A display name from the claims, falling back to the subject. Ordered by how
 * deliberately the person chose it: a handle they set, then a nickname, then
 * whatever can be read out of the identifier.
 */
export function synthesizeName(claims: Record<string, unknown>, subject: string): string {
  return (
    usableClaim(claims.preferred_username) ??
    usableClaim(claims.nickname) ??
    readableFromSubject(usableClaim(subject) ?? '')
  )
}

/** Matches Better-Auth genericOAuth's stored-email lowercase. */
export function normalizeBoundEmail(email: string): string {
  return email.toLowerCase()
}

export type ProfileFinalizationInput = Pick<
  BindingState,
  'identity' | 'acceptedClaims' | 'warnings' | 'provenance'
>

export function finalizeProfileOutcome(
  bound: ProfileFinalizationInput,
  opts: { allowMissingEmail: boolean }
): ProfileOutcome {
  const { identity, acceptedClaims, warnings, provenance } = bound
  const base = {
    provenance: provenance ?? {},
    acceptedClaims: acceptedClaims as Record<string, JsonValue>,
    warnings: warnings ?? [],
  }
  if (!identity.id) {
    return {
      ...base,
      kind: 'missing_id',
      nameSynthesized: false,
      emailVerified: false,
      placeholderEmail: false,
    }
  }
  const name = identity.name ?? synthesizeName(acceptedClaims, identity.id)
  const nameSynthesized = identity.name === undefined
  if (!identity.email) {
    return {
      ...base,
      kind: opts.allowMissingEmail ? 'placeholder_required' : 'missing_email',
      id: identity.id,
      name,
      nameSynthesized,
      emailVerified: false,
      placeholderEmail: opts.allowMissingEmail,
    }
  }
  return {
    ...base,
    kind: 'identity',
    id: identity.id,
    email: normalizeBoundEmail(identity.email),
    name,
    nameSynthesized,
    emailVerified: identity.emailVerified,
    placeholderEmail: false,
  }
}
