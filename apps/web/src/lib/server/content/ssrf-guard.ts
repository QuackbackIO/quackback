/**
 * SSRF-guard helpers for the content rehoster.
 *
 * Validates that a URL is safe to fetch from the server:
 * - scheme allow-list (http/https only)
 * - DNS resolution with every returned address checked against a
 *   private / link-local blocklist
 * - returns the resolved IP so the caller can pin it across the fetch
 *   and close DNS-rebinding TOCTOU windows
 */

import { lookup } from 'node:dns/promises'

const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

/** Return true if the URL parses and uses http or https. */
export function isSafeScheme(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ALLOWED_SCHEMES.has(parsed.protocol)
  } catch {
    return false
  }
}

/**
 * Parse an IPv4 dotted-quad string to a 32-bit number.
 * Returns null for any input that isn't a well-formed IPv4 address.
 */
function parseIpv4(addr: string): number | null {
  const parts = addr.split('.')
  if (parts.length !== 4) return null
  let result = 0
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    const n = Number(part)
    if (n < 0 || n > 255) return null
    result = (result << 8) | n
  }
  return result >>> 0
}

/** Is the given IPv4 address (as 32-bit int) inside the CIDR range (base, maskBits)? */
function ipv4InRange(ip: number, baseCidr: string): boolean {
  const [base, bitsStr] = baseCidr.split('/')
  const baseInt = parseIpv4(base)
  const bits = Number(bitsStr)
  if (baseInt === null || Number.isNaN(bits)) return false
  if (bits === 0) return true
  const mask = (0xffffffff << (32 - bits)) >>> 0
  return (ip & mask) === (baseInt & mask)
}

/**
 * Extract the embedded IPv4 address from an IPv4-mapped IPv6 address.
 * Handles both dotted-decimal (`::ffff:127.0.0.1`) and hextet
 * (`::ffff:7f00:1`) representations. Returns the IPv4 as a dotted string
 * or null if the input isn't IPv4-mapped.
 */
function extractMappedIpv4(lowerAddr: string): string | null {
  if (!lowerAddr.startsWith('::ffff:')) return null
  const suffix = lowerAddr.slice('::ffff:'.length)
  // Dotted-decimal form: ::ffff:127.0.0.1
  if (parseIpv4(suffix) !== null) {
    return suffix
  }
  // Hextet form: ::ffff:7f00:1 (= ::ffff:127.0.0.1)
  const hextets = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(suffix)
  if (hextets) {
    const hi = parseInt(hextets[1], 16)
    const lo = parseInt(hextets[2], 16)
    if (hi > 0xffff || lo > 0xffff) return null
    const ip = ((hi << 16) | lo) >>> 0
    const a = (ip >>> 24) & 0xff
    const b = (ip >>> 16) & 0xff
    const c = (ip >>> 8) & 0xff
    const d = ip & 0xff
    return `${a}.${b}.${c}.${d}`
  }
  return null
}

/**
 * IPv6 handling: we normalize to lowercase and check leading-segment prefixes.
 * This is a pragmatic approximation — we don't need full RFC 4291 parsing for
 * the small set of ranges we block.
 */
function isPrivateIpv6(addr: string): boolean {
  const lower = addr.toLowerCase()
  // IPv4-mapped IPv6 — covers both ::ffff:127.0.0.1 (dotted) and ::ffff:7f00:1 (hextet)
  const mappedV4 = extractMappedIpv4(lower)
  if (mappedV4 !== null) {
    return isPrivateIpv4(mappedV4)
  }
  // Documentation (RFC 3849) 2001:db8::/32 — non-routable
  if (/^2001:0?db8:/.test(lower)) return true
  // Loopback
  if (lower === '::1') return true
  // Unspecified
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true
  // Unique local fc00::/7 — first byte 0xfc or 0xfd
  if (/^(fc|fd)[0-9a-f]{2}:/.test(lower)) return true
  // Link-local fe80::/10 — fe8x, fe9x, feax, febx
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true
  return false
}

function isPrivateIpv4(addr: string): boolean {
  const ip = parseIpv4(addr)
  if (ip === null) return false
  const blocklist = [
    '0.0.0.0/8', // this-network
    '10.0.0.0/8', // RFC 1918
    '100.64.0.0/10', // CGNAT
    '127.0.0.0/8', // loopback
    '169.254.0.0/16', // link-local (includes cloud metadata 169.254.169.254)
    '172.16.0.0/12', // RFC 1918
    '192.168.0.0/16', // RFC 1918
  ]
  return blocklist.some((cidr) => ipv4InRange(ip, cidr))
}

/** Is the given textual IP address in any private / link-local / loopback range? */
export function isPrivateAddress(addr: string): boolean {
  if (addr.includes(':')) {
    return isPrivateIpv6(addr)
  }
  return isPrivateIpv4(addr)
}

export type UrlSafetyResult =
  | { safe: true; address: string; family: 4 | 6 }
  | { safe: false; reason: 'scheme-rejected' | 'ssrf-rejected' | 'dns-error' }

/**
 * Check that a URL is safe to fetch from the server.
 *
 * On success, returns the first public address that was resolved — the
 * caller should use this address to pin the fetch connection (e.g. via a
 * custom agent lookup function) to close the DNS rebinding TOCTOU window.
 */
export async function checkUrlSafety(url: string): Promise<UrlSafetyResult> {
  if (!isSafeScheme(url)) {
    return { safe: false, reason: 'scheme-rejected' }
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { safe: false, reason: 'scheme-rejected' }
  }
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await lookup(parsed.hostname, { all: true })
  } catch {
    return { safe: false, reason: 'dns-error' }
  }
  if (addresses.length === 0) {
    return { safe: false, reason: 'dns-error' }
  }
  // Reject if ANY resolved address is private — we won't know which one the
  // fetch would connect to without pinning.
  for (const entry of addresses) {
    if (isPrivateAddress(entry.address)) {
      return { safe: false, reason: 'ssrf-rejected' }
    }
  }
  const pinned = addresses[0]
  return {
    safe: true,
    address: pinned.address,
    family: pinned.family === 6 ? 6 : 4,
  }
}
