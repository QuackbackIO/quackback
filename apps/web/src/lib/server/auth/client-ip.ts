/**
 * The client address Better Auth sees.
 *
 * Better Auth resolves the client IP on its own, from request headers, for its
 * per-path rate limiter and for the `ipAddress` it records on every new
 * session. Left to its defaults it reads `X-Forwarded-For`, which any client
 * can set on a request it sends directly: on a direct install that lets one
 * caller pick a fresh bucket per request, and a caller that sends no header
 * lands in a single bucket every other header-less caller shares, so a few
 * wrong passwords lock everybody out of sign-in.
 *
 * Instead the app resolves the address once, with `getClientIp` (socket peer
 * when TRUSTED_PROXY_HOPS is 0, the trusted hop otherwise), and hands it to
 * Better Auth in a private header that Better Auth is configured to read and
 * nothing else. Every route into Better Auth passes through
 * `withTrustedClientIp`, which drops whatever copy of that header the client
 * sent before writing the resolved one.
 */
import { isIP } from 'node:net'
import { getClientIp } from '@/lib/server/domains/api/rate-limit'

export const CLIENT_IP_HEADER = 'x-quackback-client-ip'

/** `advanced.ipAddress` for the Better Auth instance: read only the private header. */
export const betterAuthIpAddressOptions = {
  ipAddressHeaders: [CLIENT_IP_HEADER],
}

/**
 * A copy of `source` carrying the resolved client address in the private
 * header, and never a client-supplied one. When no address can be resolved the
 * header is left absent, so Better Auth falls back to its shared bucket rather
 * than trusting anything the client wrote.
 */
export function withTrustedClientIp(source: HeadersInit): Headers {
  const headers = new Headers(source)
  headers.delete(CLIENT_IP_HEADER)
  const ip = getClientIp(headers)
  if (isIP(ip)) headers.set(CLIENT_IP_HEADER, ip)
  return headers
}

/** `withTrustedClientIp` for a whole request, body and all. */
export function withTrustedClientIpRequest(request: Request): Request {
  return new Request(request, { headers: withTrustedClientIp(request.headers) })
}

/**
 * Server-side `auth.api.*` calls forward request headers into the same Better
 * Auth code that records a session's `ipAddress`, so they get the same
 * treatment as a request through the handler. Calls without headers pass
 * through untouched.
 */
export function withTrustedClientIpArgs(args: unknown[]): unknown[] {
  const [first, ...rest] = args
  if (!first || typeof first !== 'object') return args
  const headers = (first as { headers?: HeadersInit }).headers
  if (!headers) return args
  return [{ ...first, headers: withTrustedClientIp(headers) }, ...rest]
}
