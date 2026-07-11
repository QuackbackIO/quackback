/**
 * Pure normalisation helpers for emails and domains.
 *
 * Kept dependency-free so they can be reused on the client (e.g. dedupe
 * checks in admin forms) without pulling in the database layer.
 *
 * Plus-aliases (e.g. "[email protected]") are intentionally preserved —
 * stripping them merges identities for users who explicitly chose to
 * separate them.
 */

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/

/**
 * Lowercases, trims, removes a leading `mailto:` and any surrounding
 * angle brackets. Returns `null` if the result is empty or fails a
 * permissive RFC-lite check.
 */
export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null
  let s = input.trim().toLowerCase()
  if (!s) return null
  if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1).trim()
  if (s.startsWith('mailto:')) s = s.slice('mailto:'.length).trim()
  if (!EMAIL_RE.test(s)) return null
  return s
}

/**
 * Lowercases and trims a bare domain. Strips an optional protocol prefix
 * and trailing dot. Returns `null` if the result is empty or has no dot.
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null
  let s = input.trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^https?:\/\//, '')
  // Strip path, query, and port if user pasted a URL.
  s = s.split('/')[0]
  s = s.split('?')[0]
  s = s.split('#')[0]
  s = s.split(':')[0]
  // Strip trailing dot (FQDN form).
  while (s.endsWith('.')) s = s.slice(0, -1)
  // Strip leading dot.
  while (s.startsWith('.')) s = s.slice(1)
  if (!s.includes('.')) return null
  if (!/^[a-z0-9.-]+$/.test(s)) return null
  return s
}

/**
 * Extracts the domain portion of an email address and normalises it.
 * Returns `null` if the email itself is invalid.
 */
export function parseDomainFromEmail(input: string | null | undefined): string | null {
  const email = normalizeEmail(input)
  if (!email) return null
  const at = email.lastIndexOf('@')
  if (at < 0) return null
  return normalizeDomain(email.slice(at + 1))
}
