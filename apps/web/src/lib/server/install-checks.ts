/**
 * What a self-hosted operator still has to configure, checked once at the end
 * of setup. Each check is something the install needs before people outside
 * the admin's browser can use it, and each fails quietly later if missing:
 * invites and password resets without email, logos and attachments without
 * storage, every emailed link when BASE_URL names another address.
 */
export interface InstallChecks {
  email: boolean
  storage: boolean
  address: AddressCheck
}

export interface AddressCheck {
  ok: boolean
  /** The address links and emails are built from (BASE_URL). */
  baseUrl: string
  /** The address this browser reached the install on, when it differs. */
  visitedOrigin: string | null
}

function normalizeHost(host: string, protocol: string): string {
  const lower = host.trim().toLowerCase()
  if (protocol === 'https:' && lower.endsWith(':443')) return lower.slice(0, -4)
  if (protocol === 'http:' && lower.endsWith(':80')) return lower.slice(0, -3)
  return lower
}

/**
 * Whether BASE_URL names the host the admin is using. Only the host is
 * compared: behind a proxy that terminates TLS the request can arrive as http
 * while BASE_URL rightly says https, and that is not a mistake.
 */
export function checkAddress(
  baseUrl: string,
  requestHost: string | null | undefined,
  requestProto: string | null | undefined
): AddressCheck {
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    return { ok: false, baseUrl, visitedOrigin: null }
  }
  const host = requestHost?.split(',')[0]?.trim()
  if (!host) return { ok: true, baseUrl: base.origin, visitedOrigin: null }
  const proto = (
    requestProto?.split(',')[0]?.trim() || base.protocol.replace(':', '')
  ).toLowerCase()
  const visitedProtocol = `${proto}:`
  const ok = normalizeHost(host, visitedProtocol) === normalizeHost(base.host, base.protocol)
  return { ok, baseUrl: base.origin, visitedOrigin: ok ? null : `${proto}://${host}` }
}
