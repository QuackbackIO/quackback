/**
 * Turns a decoded ID-token payload into mappable claim suggestions for the
 * rule editor: the array-of-string claims (groups/roles) and their distinct
 * values. Array claims only -- scalar claims (e.g. Entra `tid`/`oid`) are not
 * roles, and standard identity claims are never mappable. Pure + client-safe.
 */
import type { JsonValue } from '@/lib/shared/json'

export type ClaimSuggestions = {
  /** Dotted (or literal URL) claim paths whose value is a non-empty string[]. */
  paths: string[]
  /** Distinct string values at each path, first-seen order. */
  valuesByPath: Record<string, string[]>
}

/** Standard OIDC/identity claims that are never role/group mappings. */
const STANDARD_CLAIMS = new Set([
  'iss',
  'sub',
  'aud',
  'exp',
  'iat',
  'nbf',
  'jti',
  'nonce',
  'azp',
  'at_hash',
  'c_hash',
  'email',
  'email_verified',
  'name',
  'preferred_username',
  'given_name',
  'family_name',
  'ver',
  'tid',
  'oid',
  'rh',
  'uti',
  'aio',
  // Auth-method/context claims: `amr` is a standard array (e.g. ['pwd','mfa'])
  // that must not be offered as a role/group mapping.
  'amr',
  'acr',
  'sid',
])

function dedupeStrings(arr: JsonValue[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of arr) {
    if (typeof v === 'string' && v !== '' && !seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }
  return out
}

export function deriveClaimSuggestions(allClaims: Record<string, JsonValue>): ClaimSuggestions {
  const paths: string[] = []
  const valuesByPath: Record<string, string[]> = {}

  const record = (path: string, value: JsonValue) => {
    if (!Array.isArray(value)) return
    const values = dedupeStrings(value)
    if (values.length === 0) return
    paths.push(path)
    valuesByPath[path] = values
  }

  for (const [key, value] of Object.entries(allClaims)) {
    if (STANDARD_CLAIMS.has(key)) continue
    // URL-shaped keys are literal (never split); only record array leaves.
    if (key.includes('://')) {
      record(key, value)
      continue
    }
    if (Array.isArray(value)) {
      record(key, value)
    } else if (value !== null && typeof value === 'object') {
      // Depth-2 only, e.g. realm_access.roles. Skip URL-shaped child keys so
      // the dotted path stays resolvable by getNestedClaim at sign-in.
      for (const [childKey, childValue] of Object.entries(value)) {
        if (childKey.includes('://')) continue
        record(`${key}.${childKey}`, childValue as JsonValue)
      }
    }
  }

  return { paths, valuesByPath }
}

/**
 * Protocol claims that are never useful as person-attribute sources.
 * Profile claims (`email`, `name`, `preferred_username`, …) stay — mapping
 * `preferred_username` onto a username attribute is legitimate.
 */
const PROTOCOL_CLAIMS = new Set([
  'iss',
  'aud',
  'exp',
  'iat',
  'nbf',
  'jti',
  'nonce',
  'azp',
  'at_hash',
  'c_hash',
  'sid',
  'rh',
  'uti',
  'aio',
  'ver',
  'amr',
  'acr',
  'sub',
])

export type AttributeClaimPathSuggestion = {
  path: string
  description?: string
}

function truncatePreview(value: JsonValue, max = 48): string {
  let text: string
  if (Array.isArray(value)) {
    text = value
      .map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v)))
      .join(', ')
  } else if (value !== null && typeof value === 'object') {
    text = JSON.stringify(value)
  } else {
    text = String(value)
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function isLeaf(value: JsonValue): boolean {
  return value === null || typeof value !== 'object' || Array.isArray(value)
}

/**
 * Leaf claim paths (scalars and arrays) at depth ≤ 2, for mapping onto
 * person attributes. URL-shaped keys are literal. Each suggestion carries a
 * truncated observed value as `description`.
 */
export function deriveAttributeClaimPaths(
  allClaims: Record<string, JsonValue>
): AttributeClaimPathSuggestion[] {
  const out: AttributeClaimPathSuggestion[] = []

  const record = (path: string, value: JsonValue) => {
    if (!isLeaf(value)) return
    out.push({ path, description: truncatePreview(value) })
  }

  for (const [key, value] of Object.entries(allClaims)) {
    if (PROTOCOL_CLAIMS.has(key)) continue
    if (key.includes('://')) {
      record(key, value)
      continue
    }
    if (isLeaf(value)) {
      record(key, value)
    } else if (value !== null && typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) {
        if (childKey.includes('://')) continue
        record(`${key}.${childKey}`, childValue as JsonValue)
      }
    }
  }

  return out
}
