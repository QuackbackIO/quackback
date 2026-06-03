/**
 * ISO-3166-1 alpha-2 country capture from CDN-injected request headers.
 *
 * Stays vendor-neutral: each header below is set by a different CDN /
 * reverse proxy, and we take the first valid value we find. Self-hosters
 * behind a custom proxy can populate `X-Country-Code` directly.
 *
 * Returns `null` when no header is present (local dev or deployments
 * without a geo-aware proxy) — callers should treat that as "keep the
 * existing value" rather than blanking the column.
 */
const COUNTRY_HEADERS = [
  'cf-ipcountry', // Cloudflare
  'x-vercel-ip-country', // Vercel
  'fly-client-ip-country', // Fly.io
  'x-country-code', // generic / self-hosted
] as const

export function captureCountryFromHeaders(headers: Headers): string | null {
  for (const name of COUNTRY_HEADERS) {
    const raw = headers.get(name)
    if (!raw) continue
    const code = raw.trim().toUpperCase()
    // ISO-3166-1 alpha-2 — strictly two A-Z letters. "XX" and "T1" (Tor)
    // are common CDN sentinels for unknown; we drop those.
    if (/^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== 'T1') {
      return code
    }
  }
  return null
}
