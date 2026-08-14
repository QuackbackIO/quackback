/**
 * OIDC scope parsing shared by the auth runtime, the connection test, and the
 * admin editor.
 *
 * One resolver: a blank column means the defaults everywhere. Registration and
 * the connection test previously disagreed on that, so a stored blank made the
 * test exercise a different scope set from production.
 */

/** Requested when a provider has no explicit `scopes`. */
export const DEFAULT_OIDC_SCOPES = ['openid', 'email', 'profile'] as const

/**
 * The one scope that cannot be dropped. Without it the request is not an OIDC
 * request: the IdP owes no ID token, and userinfo has no openid-scoped token.
 */
export const REQUIRED_OIDC_SCOPE = 'openid'

/**
 * Split a stored scope string into tokens. The column is documented as space-
 * OR comma-joined, so accept both; de-duplicate, preserving first-seen order.
 */
export function parseScopes(raw: string | null | undefined): string[] {
  const seen = new Set<string>()
  for (const token of (raw ?? '').split(/[\s,]+/)) {
    if (token) seen.add(token)
  }
  return [...seen]
}

/** The scopes a provider actually requests. Blank or null means the defaults. */
export function effectiveScopes(provider: { scopes: string | null | undefined }): string[] {
  const parsed = parseScopes(provider.scopes)
  return parsed.length > 0 ? parsed : [...DEFAULT_OIDC_SCOPES]
}

/**
 * Which requested scopes the IdP does not advertise in `scopes_supported`.
 *
 * An empty or absent list means unknown, not "none supported".
 */
export function unsupportedScopes(
  requested: readonly string[],
  supported: readonly string[] | null | undefined
): string[] {
  if (!supported || supported.length === 0) return []
  const advertised = new Set(supported)
  return requested.filter((scope) => !advertised.has(scope))
}

/**
 * The requested set reduced to what the IdP advertises — the one-click fix.
 * `openid` survives regardless.
 */
export function supportedSubset(
  requested: readonly string[],
  supported: readonly string[] | null | undefined
): string[] {
  if (!supported || supported.length === 0) return [...requested]
  const advertised = new Set(supported)
  return requested.filter((scope) => advertised.has(scope) || scope === REQUIRED_OIDC_SCOPE)
}

/**
 * Turn the editor's token list into the value to persist.
 *
 * Returns null — never a blank string — when the set is empty or matches the
 * defaults, so "null means defaults" survives the editor prefilling the
 * effective value.
 */
export function normalizeScopesInput(tokens: readonly string[]): string | null {
  const cleaned = parseScopes(tokens.join(' '))
  if (cleaned.length === 0) return null

  const isDefaultSet =
    cleaned.length === DEFAULT_OIDC_SCOPES.length &&
    DEFAULT_OIDC_SCOPES.every((scope) => cleaned.includes(scope))
  return isDefaultSet ? null : cleaned.join(' ')
}
