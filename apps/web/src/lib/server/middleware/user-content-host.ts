/**
 * The user-content host (`USER_CONTENT_URL`) serves stored files and nothing
 * else.
 *
 * Files load from that origin so that one a browser renders cannot act as
 * the app. The same server answers both hosts, though, so without this every
 * page, server function and upload route would answer there too. A request
 * whose Host (or forwarded host) names the user-content host reaches only
 * GET, HEAD and OPTIONS under /api/storage/; anything else is a 404.
 *
 * Under pooled tenancy the setting is ignored (the config getter returns
 * nothing), and so is this. The config is imported on first use: `start.ts`
 * is a client entry as well as a server one.
 */
import { createMiddleware } from '@tanstack/react-start'

const STORAGE_PREFIX = '/api/storage/'
const STORAGE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** A host as compared here: lower case, no trailing dot, no default port. */
function normalizeHost(value: string | null | undefined): string | null {
  const host = value?.split(',')[0]?.trim().toLowerCase().replace(/\.$/, '')
  return host ? host.replace(/:(?:80|443)$/, '') : null
}

function hostOf(url: string): string | null {
  try {
    return normalizeHost(new URL(url).host)
  } catch {
    return null
  }
}

function isStorageRead(request: Request): boolean {
  const { pathname } = new URL(request.url)
  return (
    STORAGE_METHODS.has(request.method) &&
    pathname.startsWith(STORAGE_PREFIX) &&
    pathname.length > STORAGE_PREFIX.length
  )
}

interface NextResult {
  response?: Response
}

export async function handleUserContentHost<T extends NextResult>({
  request,
  next,
}: {
  request: Request
  next: () => Promise<T>
}): Promise<T | Response> {
  const { config } = await import('@/lib/server/config')
  const userContentHost = config.userContentUrl ? hostOf(config.userContentUrl) : null
  // A user-content host that is the app's own would leave the app nothing.
  if (!userContentHost || userContentHost === hostOf(config.baseUrl)) return next()

  const hosts = [
    normalizeHost(request.headers.get('host')),
    normalizeHost(request.headers.get('x-forwarded-host')),
  ]
  if (!hosts.includes(userContentHost) || isStorageRead(request)) return next()
  return Response.json({ error: 'Not found' }, { status: 404 })
}

export const userContentHostMiddleware = createMiddleware().server(({ next, request }) =>
  handleUserContentHost({ request, next: () => Promise.resolve(next()) })
)
