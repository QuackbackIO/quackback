/**
 * Carries Better Auth's signed authorize query to the consent page unchanged.
 *
 * The consent submit posts that query back as `oauth_query`, and Better Auth
 * checks its signature value by value. The router cannot carry it as plain
 * search params: it reads repeated keys (`ba_param`, `resource`) as one JSON
 * array and numbers-looking values as numbers, then redirects to its own
 * spelling of the URL, so the signature no longer matches.
 *
 * So Better Auth sends people to {@link CONSENT_START_PATH}, a server route
 * that moves the whole query, byte for byte, into the one `oauth_query` param
 * of `/oauth/consent`. A single param whose value starts with a key name is
 * never JSON, so the router leaves it as it is. The client, scope and redirect
 * also stay readable in the address bar; the page never reads them from there.
 */
import { CLIENT_REQUESTED_SCOPE_PARAM } from '@/lib/shared/mcp-consent-scopes'

export const CONSENT_PAGE_PATH = '/oauth/consent'

/** Better Auth's `consentPage`: the server route that hands off to the page. */
export const CONSENT_START_PATH = '/oauth/consent/start'

export const CONSENT_QUERY_PARAM = 'oauth_query'

/** Shown in the address bar beside the carried query, for whoever reads the URL. */
const READABLE_PARAMS = ['client_id', 'scope', CLIENT_REQUESTED_SCOPE_PARAM, 'redirect_uri']

/** The consent page URL that carries `rawSearch` (with or without `?`) unchanged. */
export function consentPageLocation(rawSearch: string): string {
  const raw = rawSearch.replace(/^\?/, '')
  const signed = new URLSearchParams(raw)
  const query = new URLSearchParams()
  for (const name of READABLE_PARAMS) {
    const value = signed.get(name)
    if (value !== null) query.set(name, value)
  }
  query.set(CONSENT_QUERY_PARAM, raw)
  return `${CONSENT_PAGE_PATH}?${query}`
}

/**
 * The signed query to post back, from the page's search as the router parsed
 * it. A link minted before the hand-off existed has the signed params spread
 * over the URL instead: rebuild that as closely as the router's parse allows,
 * with an array expanded back into repeated keys.
 */
export function consentQueryFromSearch(search: Record<string, unknown>): string {
  const carried = search[CONSENT_QUERY_PARAM]
  if (typeof carried === 'string') return carried
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null) continue
    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(key, typeof item === 'string' ? item : JSON.stringify(item))
    }
  }
  return params.toString()
}

/** The authorize params the page shows, read from the signed query. */
export function consentQueryFields(oauthQuery: string) {
  const params = new URLSearchParams(oauthQuery)
  return {
    clientId: params.get('client_id') ?? '',
    scope: params.get('scope') ?? undefined,
    redirectUri: params.get('redirect_uri') ?? undefined,
    requested: params.get(CLIENT_REQUESTED_SCOPE_PARAM) ?? undefined,
  }
}
