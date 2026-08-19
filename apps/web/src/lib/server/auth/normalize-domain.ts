import { domainToASCII } from 'node:url'
import { z } from 'zod'

/**
 * RFC 6761 reserved suffixes — never legitimate verifiable domains.
 * `.localhost` and `.example` are commonly forgotten alongside the
 * better-known `.test` / `.invalid`.
 */
const RESERVED_SUFFIXES = ['.test', '.example', '.invalid', '.localhost']

/**
 * Canonicalise a domain string for storage and comparison.
 *
 * Rules:
 *  - Trim and strip a single trailing dot (`acme.com.` → `acme.com`).
 *  - Run through `URL.domainToASCII` so IDN labels become punycode.
 *  - Lowercase the ASCII form.
 *  - Reject single-label hostnames (must contain at least one dot).
 *  - Reject IP literals (v4 dotted-quad, v6 colons).
 *  - Reject RFC 6761 reserved suffixes.
 *
 * Returns null when the input fails any rule. Callers treat null as
 * "invalid domain" — never persist or compare against a null result.
 *
 * Used both at write time (`setSsoDomainFn`) and at read time
 * (`isEmailAtVerifiedDomain`) so a stored canonical name matches a
 * mixed-case or trailing-dot email without ambiguity.
 */
export function normalizeDomain(input: string | undefined | null): string | null {
  if (!input) return null
  const trimmed = input.trim().replace(/\.$/, '')
  if (!trimmed) return null

  // IPv4 literal — `domainToASCII` would happily echo it back, but
  // we want explicit rejection.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(trimmed)) return null
  // IPv6 literal — colons are illegal in DNS labels anyway.
  if (trimmed.includes(':')) return null

  const ascii = domainToASCII(trimmed)
  if (!ascii) return null

  const lower = ascii.toLowerCase()
  if (!lower.includes('.')) return null

  for (const suffix of RESERVED_SUFFIXES) {
    if (lower === suffix.slice(1) || lower.endsWith(suffix)) return null
  }

  return lower
}

/**
 * Extract and canonicalise the domain portion of an email address.
 * `Foo+PostTag@ACME.COM.` → `acme.com`. Returns null if the input doesn't
 * contain a single `@` or the domain part fails normalisation.
 */
export function emailDomain(email: string | undefined | null): string | null {
  if (!email) return null
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1) return null
  return normalizeDomain(email.slice(at + 1))
}

/**
 * Verifiable domain name — what an admin pastes when claiming `acme.com`
 * for SSO. Validates AND normalises in one step via the transformer;
 * downstream callers always see the canonical lowercase ASCII form.
 *
 * Lives here (server-only) rather than in `lib/shared/schemas/auth.ts`
 * because `normalizeDomain` depends on `node:url`, which Vite externalises
 * for browser builds. Importing the shared schemas file from a client
 * component would otherwise pull this transitive dependency into the
 * client bundle and fail at runtime.
 */
export const verifiableDomain = z
  .string()
  .min(1, 'Domain is required')
  .max(253, 'Domain too long')
  .transform((v, ctx) => {
    const norm = normalizeDomain(v)
    if (norm === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Must be a public FQDN (e.g. "acme.com")',
      })
      return z.NEVER
    }
    return norm
  })
