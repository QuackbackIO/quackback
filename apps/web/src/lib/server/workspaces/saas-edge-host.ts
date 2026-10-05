/**
 * How a Cloudflare-for-SaaS custom host becomes a workspace Host.
 *
 * Railway only accepts names we registered. The edge Worker fetches the
 * origin in QUACKBACK_SAAS_RAILWAY_ORIGIN and sends the visitor hostname in
 * `x-quackback-customer-host`, signed with `QUACKBACK_SAAS_EDGE_SECRET`.
 *
 * Trust that header only when:
 *   1. this request arrived as a trusted Railway/fallback origin, and
 *   2. the HMAC matches.
 *
 * A stranger hitting the Railway origin with a forged header fails (1) if they
 * also lack the secret, and (2) if they have the name but not the signature.
 * The Worker (`quackback-cp/workers/saas-origin`) is the only signer.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'

export const CUSTOMER_HOST_HEADER = 'x-quackback-customer-host'
export const CUSTOMER_HOST_SIG_HEADER = 'x-quackback-customer-host-sig'
export const SIGNED_PREFIX = 'v1:'

export function hostnameOnly(value: string | null | undefined): string | null {
  if (!value) return null
  const host = value.split(':')[0]?.trim().toLowerCase() ?? ''
  return host.length > 0 ? host : null
}

export function signCustomerHost(secret: string, hostname: string): string {
  return createHmac('sha256', secret).update(`${SIGNED_PREFIX}${hostname}`).digest('hex')
}

export function verifyCustomerHostSignature(
  secret: string,
  hostname: string,
  signature: string | null | undefined
): boolean {
  if (!secret || !hostname || !signature) return false
  const expected = signCustomerHost(secret, hostname)
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

function trustedOriginHosts(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const hosts = new Set<string>()
  for (const raw of [env.QUACKBACK_SAAS_FALLBACK_ORIGIN, env.QUACKBACK_SAAS_RAILWAY_ORIGIN]) {
    const host = hostnameOnly(raw ?? null)
    if (host) hosts.add(host)
  }
  return hosts
}

/**
 * The customer hostname a signed edge request carries, or null when the
 * request did not arrive as a trusted origin or the signature does not verify.
 */
export function verifiedCustomerHost(
  requestHost: string | null,
  headers: Headers,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (!requestHost || !trustedOriginHosts(env).has(requestHost)) return null
  const customer = hostnameOnly(headers.get(CUSTOMER_HOST_HEADER))
  const secret = env.QUACKBACK_SAAS_EDGE_SECRET?.trim() ?? ''
  const sig = headers.get(CUSTOMER_HOST_SIG_HEADER)
  if (
    customer &&
    customer !== requestHost &&
    customer.includes('.') &&
    verifyCustomerHostSignature(secret, customer, sig)
  ) {
    return customer
  }
  return null
}

/**
 * Workspace hostname for this request. Custom-host traffic arrives as a
 * trusted origin plus a signed customer-host header; everything else uses Host.
 */
export function requestWorkspaceHost(
  request: Request,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const host =
    hostnameOnly(request.headers.get('host')) ?? hostnameOnly(new URL(request.url).hostname)
  return verifiedCustomerHost(host, request.headers, env) ?? host
}

/*
 * Visitor address for custom-host traffic.
 *
 * The trusted edge proxy that serves custom hostnames is itself the TCP peer
 * of every such request, so neither the socket address nor X-Forwarded-For
 * names the visitor. The proxy signs the visitor address it observed:
 *
 *   x-quackback-edge-client-ip:     the address (IPv4 or IPv6 text)
 *   x-quackback-edge-client-ip-sig: `<unixSeconds>.<hex>`, where hex is
 *     HMAC-SHA256(QUACKBACK_SAAS_EDGE_SECRET,
 *                 `ip-v1:<customerHost>:<ip>:<unixSeconds>`)
 *
 * The signature binds the address to the customer host the same request
 * carries, so it is trusted only alongside a verified customer host, and only
 * within EDGE_CLIENT_IP_MAX_SKEW_SECONDS of the signing time.
 */
export const EDGE_CLIENT_IP_HEADER = 'x-quackback-edge-client-ip'
export const EDGE_CLIENT_IP_SIG_HEADER = 'x-quackback-edge-client-ip-sig'
export const EDGE_CLIENT_IP_PREFIX = 'ip-v1:'
export const EDGE_CLIENT_IP_MAX_SKEW_SECONDS = 300

const EDGE_CLIENT_IP_SIG_PATTERN = /^([1-9]\d{0,14})\.([0-9a-f]{64})$/

export function signEdgeClientIp(
  secret: string,
  customerHost: string,
  ip: string,
  unixSeconds: number
): string {
  return createHmac('sha256', secret)
    .update(`${EDGE_CLIENT_IP_PREFIX}${customerHost}:${ip}:${unixSeconds}`)
    .digest('hex')
}

/** Why a request's edge visitor address was not trusted. */
export type EdgeClientIpRejection =
  | 'secret-unset'
  | 'malformed-signature'
  | 'stale-timestamp'
  | 'invalid-address'
  | 'untrusted-origin'
  | 'unverified-customer-host'
  | 'signature-mismatch'

export type EdgeClientIpResult = { ip: string } | { rejected: EdgeClientIpRejection }

/**
 * Verifies the signed visitor address on a request, naming the first check
 * that fails. Null when the request carries no address. Callers fall back to
 * their usual resolution on any rejection.
 *
 * `secret-unset` and `untrusted-origin` come first: they mark a header that
 * did not come through the edge proxy at all, so every later reason describes
 * a request that plausibly did.
 */
export function checkEdgeClientIp(
  headers: Headers,
  requestHost: string | null,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now()
): EdgeClientIpResult | null {
  const ip = headers.get(EDGE_CLIENT_IP_HEADER)
  if (!ip) return null
  const secret = env.QUACKBACK_SAAS_EDGE_SECRET?.trim() ?? ''
  if (!secret) return { rejected: 'secret-unset' }
  if (!requestHost || !trustedOriginHosts(env).has(requestHost)) {
    return { rejected: 'untrusted-origin' }
  }
  const match = EDGE_CLIENT_IP_SIG_PATTERN.exec(headers.get(EDGE_CLIENT_IP_SIG_HEADER) ?? '')
  if (!match) return { rejected: 'malformed-signature' }
  const unixSeconds = Number(match[1])
  if (Math.abs(nowMs / 1000 - unixSeconds) > EDGE_CLIENT_IP_MAX_SKEW_SECONDS) {
    return { rejected: 'stale-timestamp' }
  }
  if (!isIP(ip)) return { rejected: 'invalid-address' }
  const customer = verifiedCustomerHost(requestHost, headers, env)
  if (!customer) return { rejected: 'unverified-customer-host' }
  const expected = Buffer.from(signEdgeClientIp(secret, customer, ip, unixSeconds), 'utf8')
  const given = Buffer.from(match[2]!, 'utf8')
  return expected.length === given.length && timingSafeEqual(expected, given)
    ? { ip }
    : { rejected: 'signature-mismatch' }
}

/** The verified visitor address on this request, or null. */
export function edgeClientIp(
  headers: Headers,
  requestHost: string | null,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now()
): string | null {
  const result = checkEdgeClientIp(headers, requestHost, env, nowMs)
  return result && 'ip' in result ? result.ip : null
}
