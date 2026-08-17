/**
 * How a Cloudflare-for-SaaS custom host becomes a workspace Host.
 *
 * Railway only accepts names we registered. The edge Worker fetches our
 * `*.up.railway.app` origin and sends the visitor's hostname in
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
 * Workspace hostname for this request. Custom-host traffic arrives as a
 * trusted origin plus a signed customer-host header; everything else uses Host.
 */
export function requestWorkspaceHost(
  request: Request,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const host =
    hostnameOnly(request.headers.get('host')) ?? hostnameOnly(new URL(request.url).hostname)
  const trusted = trustedOriginHosts(env)
  if (host && trusted.has(host)) {
    const customer = hostnameOnly(request.headers.get(CUSTOMER_HOST_HEADER))
    const secret = env.QUACKBACK_SAAS_EDGE_SECRET?.trim() ?? ''
    const sig = request.headers.get(CUSTOMER_HOST_SIG_HEADER)
    if (
      customer &&
      customer !== host &&
      customer.includes('.') &&
      verifyCustomerHostSignature(secret, customer, sig)
    ) {
      return customer
    }
  }
  return host
}
