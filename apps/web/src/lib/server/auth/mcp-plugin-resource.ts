/**
 * Better Auth 1.7.4 `mcp()` refuses HTTP resource URLs unless the host is
 * exactly `localhost`, `[::1]`, or 127/8. RFC 6761 `*.localhost` (what e2e
 * uses as `acme.localhost`) is loopback, but the plugin does not treat it
 * that way and `createAuth()` throws on every request.
 *
 * Collapse `*.localhost` to `localhost` for the plugin's validated `resource`
 * only. PRM and our token verifier keep the public `BASE_URL`.
 */
export function betterAuthMcpResource(resource: string): string {
  const url = new URL(resource)
  if (url.protocol === 'https:') return resource
  if (url.hostname === 'localhost' || url.hostname === '[::1]') return resource
  if (/^127(?:\.\d+){3}$/.test(url.hostname)) return resource
  if (url.hostname.endsWith('.localhost')) {
    url.hostname = 'localhost'
    return url.href
  }
  return resource
}
