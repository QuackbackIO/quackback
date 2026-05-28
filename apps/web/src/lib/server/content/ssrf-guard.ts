/**
 * SSRF-guard helpers for server-side outbound fetches.
 *
 * Validates that a URL is safe to fetch from the server:
 * - scheme allow-list (http/https only)
 * - DNS resolution with every returned address checked against a
 *   private / link-local blocklist
 * - returns the resolved IP so the caller can pin it across the fetch
 *   and close DNS-rebinding TOCTOU windows
 *
 * `safeFetch` is the pinned-fetch primitive: validate, then connect to
 * the *validated IP* — never re-resolving the hostname — so a DNS
 * rebind between the check and the connect cannot redirect the request
 * at a private address. Prefer it over `checkUrlSafety` + `fetch`.
 */

import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { checkServerIdentity } from 'node:tls'
import type { IncomingMessage } from 'node:http'

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

/** Thrown by `safeFetch` when the target URL fails SSRF validation. */
export class SsrfError extends Error {
  constructor(public readonly reason: 'scheme-rejected' | 'ssrf-rejected' | 'dns-error') {
    super(`URL rejected by SSRF guard: ${reason}`)
    this.name = 'SsrfError'
  }
}

/** Thrown by `safeFetch` when the body exceeds the cap and `onOverflow: 'error'`. */
export class ResponseTooLargeError extends Error {
  constructor(public readonly maxResponseBytes: number) {
    super(`safeFetch: response body exceeded ${maxResponseBytes} bytes`)
    this.name = 'ResponseTooLargeError'
  }
}

/** Thrown by `safeFetch` when the request exceeds `timeoutMs`. */
export class TimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`safeFetch: request timed out after ${timeoutMs}ms`)
    this.name = 'TimeoutError'
  }
}

export interface SafeFetchInit {
  method?: string
  headers?: Record<string, string>
  /** Request body for POST/PUT. */
  body?: string
  /** Per-request timeout in ms. Default 5000. */
  timeoutMs?: number
  /** Hard cap on the buffered response body. Default 64 KiB. */
  maxResponseBytes?: number
  /**
   * What to do when the body exceeds `maxResponseBytes`:
   * - `'truncate'` (default): cut the stream and resolve with the bytes that
   *   arrived before the cap. Right for JSON metadata endpoints (JWKS, OIDC).
   * - `'error'`: reject with `ResponseTooLargeError`. Right for callers that
   *   must not act on a partial body (e.g. image rehosting).
   */
  onOverflow?: 'truncate' | 'error'
}

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024

/**
 * SSRF-safe HTTP(S) fetch.
 *
 * Validates the host via `checkUrlSafety`, then connects to the
 * *validated IP literal* — never re-resolving the hostname — closing
 * the DNS-rebinding TOCTOU window that `checkUrlSafety` + `fetch`
 * leaves open (the bare `fetch` does its own second resolution).
 *
 * - The connection target is pinned to the validated IP; TLS SNI and
 *   certificate identity are validated against the *original*
 *   hostname, so vhosted IdPs route correctly and the cert still has
 *   to match the real name.
 * - Redirects are never followed — a 3xx is returned verbatim.
 *   Following it would re-resolve an unvalidated host.
 * - The body is buffered with a hard `maxResponseBytes` cap and
 *   returned as a standard `Response`, so a hostile peer cannot
 *   stream an unbounded body.
 *
 * Throws `SsrfError` on validation failure; rejects with the
 * underlying error on network failure / timeout.
 */
export async function safeFetch(url: string, init: SafeFetchInit = {}): Promise<Response> {
  const safety = await checkUrlSafety(url)
  if (!safety.safe) throw new SsrfError(safety.reason)

  const parsed = new URL(url)
  const isHttps = parsed.protocol === 'https:'
  const requestFn = isHttps ? httpsRequest : httpRequest
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    onOverflow = 'truncate',
  } = init

  return new Promise<Response>((resolve, reject) => {
    const req = requestFn(
      {
        // Connection target: the validated IP. No second DNS lookup
        // happens because this is an address literal, so the TOCTOU
        // window between validation and connect is closed.
        hostname: safety.address,
        family: safety.family,
        port: Number(parsed.port || (isHttps ? 443 : 80)),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        // SNI + HTTP Host carry the original hostname; the cert is
        // validated against it, not the IP we dialled.
        servername: isHttps ? parsed.hostname : undefined,
        headers: { ...headers, host: parsed.host },
        timeout: timeoutMs,
        checkServerIdentity: isHttps
          ? (_host: string, cert: Parameters<typeof checkServerIdentity>[1]) =>
              checkServerIdentity(parsed.hostname, cert)
          : undefined,
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = []
        let total = 0
        const finish = () => {
          const status = res.statusCode ?? 502
          const nullBody = status < 200 || status === 204 || status === 304
          const headerEntries: [string, string][] = []
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === 'string') headerEntries.push([k, v])
            else if (Array.isArray(v)) headerEntries.push([k, v.join(', ')])
          }
          resolve(
            new Response(nullBody ? null : Buffer.concat(chunks), {
              status,
              statusText: res.statusMessage ?? '',
              headers: headerEntries,
            })
          )
        }
        res.on('data', (chunk: Buffer) => {
          total += chunk.length
          if (total > maxResponseBytes) {
            // Over cap: cut the stream either way. In 'error' mode reject so
            // the caller never acts on a partial body; otherwise keep what
            // arrived before the over-cap chunk and resolve with it.
            res.destroy()
            if (onOverflow === 'error') {
              reject(new ResponseTooLargeError(maxResponseBytes))
              return
            }
            finish()
            return
          }
          chunks.push(chunk)
        })
        res.on('end', finish)
        res.on('error', reject)
      }
    )
    req.on('timeout', () => req.destroy(new TimeoutError(timeoutMs)))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}
