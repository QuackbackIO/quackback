/**
 * A first-party path for the product analytics SDK, so its requests go to the
 * page's own origin instead of a third-party host that content blockers drop.
 *
 * It forwards to the configured PostHog host only, and only the SDK's own
 * endpoints: the path can never name another host or another part of it, the
 * browser's cookies and credentials are never sent on, and the client address
 * travels as `X-Forwarded-For` so PostHog's own IP handling applies as if the
 * browser had called it directly.
 */

const ASSET_PREFIXES = ['/static/', '/array/']

/**
 * The endpoints the browser SDK calls: ingestion, flags, its own scripts and
 * the public feature APIs it reads with the project key. Anything else 404s,
 * so the relay never exposes the rest of a PostHog host, which matters when
 * that host is a self-hosted instance on a private network.
 */
const RELAYED_PREFIXES = [
  '/e/',
  '/s/',
  '/i/',
  '/flags/',
  '/decide/',
  '/batch/',
  ...ASSET_PREFIXES,
  '/api/surveys/',
  '/api/web_experiments/',
  '/api/product_tours/',
  '/api/early_access_features/',
]
const FORWARDED_REQUEST_HEADERS = ['content-type', 'content-encoding', 'accept', 'user-agent']
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'cache-control', 'vary']

/**
 * PostHog Cloud serves the SDK and its config from a separate assets host
 * (`us.i.posthog.com` → `us-assets.i.posthog.com`); a self-hosted PostHog
 * serves both from one.
 */
export function upstreamFor(apiHost: string, path: string): string | null {
  if (!path.startsWith('/') || path.startsWith('//')) return null
  // Judge the path as it will be requested: `/e/../admin` normalises to `/admin`.
  const { pathname } = new URL(path, 'http://relay.invalid')
  if (!RELAYED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null
  const api = new URL(apiHost)
  const region = api.hostname.match(/^([a-z]+)\.i\.posthog\.com$/)?.[1]
  const host =
    region && ASSET_PREFIXES.some((p) => pathname.startsWith(p))
      ? `${api.protocol}//${region}-assets.i.posthog.com`
      : api.origin
  const url = new URL(pathname, host)
  return url.origin === new URL(host).origin ? url.toString() : null
}

/** The PostHog app the toolbar links to (`us.i.posthog.com` → `us.posthog.com`). */
export function posthogUiHost(apiHost: string): string {
  const api = new URL(apiHost)
  const region = api.hostname.match(/^([a-z]+)\.i\.posthog\.com$/)?.[1]
  return region ? `${api.protocol}//${region}.posthog.com` : api.origin
}

function clientAddress(request: Request): string | null {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip')
  )
}

export async function relayToPostHog(
  request: Request,
  opts: { apiHost: string; prefix: string }
): Promise<Response> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith(`${opts.prefix}/`)) return new Response(null, { status: 404 })
  const target = upstreamFor(opts.apiHost, url.pathname.slice(opts.prefix.length))
  if (!target) return new Response(null, { status: 404 })

  const headers = new Headers()
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  const ip = clientAddress(request)
  if (ip) headers.set('x-forwarded-for', ip)

  try {
    const upstream = await fetch(`${target.split('?')[0]}${url.search}`, {
      method: request.method,
      headers,
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await request.arrayBuffer(),
      redirect: 'manual',
    })
    const out = new Headers()
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name)
      if (value) out.set(name, value)
    }
    return new Response(upstream.body, { status: upstream.status, headers: out })
  } catch {
    return new Response(null, { status: 502 })
  }
}
