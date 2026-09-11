import {
  API_KEY_SCOPES,
  MCP_AS_SCOPES,
  MCP_FIRST_CONNECT_SCOPES,
  expandWriteGrants,
} from '@/lib/shared/api-key-scopes'

/**
 * Preserved on `/oauth2/authorize` so the consent page can default to what
 * the client actually asked for (MCP first-connect or a step-up union).
 * Better Auth's authorize schema is `.passthrough()`, so this survives
 * signing and is copied onto `/oauth/consent`.
 */
export const CLIENT_REQUESTED_SCOPE_PARAM = 'qb_requested_scope'

/** Identity scopes implicit in signing in — granted, never shown as toggles. */
export const MCP_IDENTITY_SCOPES = ['openid', 'profile', 'email'] as const

export function parseScopeList(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw.split(/[+\s]+/).filter(Boolean)
}

/**
 * What the client asked for, used only to prefill toggles.
 * After authorize rewrite, that lives on `qb_requested_scope`. If the
 * consent URL was expanded but the param is missing, ignore the full
 * catalogue `scope=` so writes do not default on.
 */
export function clientRequestedFromConsentSearch(params: {
  requested?: string
  scope?: string
}): string[] {
  if (params.requested !== undefined) return parseScopeList(params.requested)
  const fromScope = parseScopeList(params.scope)
  const expanded = expandAuthorizeScopes().split(' ')
  if (
    fromScope.length === expanded.length &&
    expanded.every((scope) => fromScope.includes(scope))
  ) {
    return [...MCP_FIRST_CONNECT_SCOPES]
  }
  return fromScope
}

/** The AS allow-list, in catalogue order — what consent is allowed to grant. */
export function expandAuthorizeScopes(): string {
  return MCP_AS_SCOPES.join(' ')
}

function isFullAsCatalogue(raw: string): boolean {
  const held = new Set(parseScopeList(raw))
  return held.size === MCP_AS_SCOPES.length && MCP_AS_SCOPES.every((scope) => held.has(scope))
}

/**
 * MCP clients follow the spec and first-request only PRM / 401 scopes (the
 * three reads). Better Auth then refuses any consent grant that was not on
 * that authorize request. Expand `scope` to the full allow-list so the user
 * can opt into writes now; keep the original request for defaults.
 *
 * A client-supplied `qb_requested_scope` is ignored on the first hop — only
 * `scope=` is the request. The second pass is identified by `scope` already
 * being the catalogue, not by the param being present.
 *
 * @see https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices#scope-minimization
 */
export function rewriteMcpAuthorizeRequest(request: Request): Request {
  const url = new URL(request.url)
  if (!url.pathname.endsWith('/oauth2/authorize')) return request
  const scope = url.searchParams.get('scope') ?? ''
  if (isFullAsCatalogue(scope)) {
    if (!url.searchParams.has(CLIENT_REQUESTED_SCOPE_PARAM)) {
      url.searchParams.set(CLIENT_REQUESTED_SCOPE_PARAM, scope)
      return new Request(url, request)
    }
    return request
  }
  url.searchParams.set(CLIENT_REQUESTED_SCOPE_PARAM, scope)
  url.searchParams.set('scope', expandAuthorizeScopes())
  return new Request(url, request)
}

/**
 * Prefill: PRM / 401 first-connect reads, plus anything this authorize
 * actually asked for (step-up unions in writes). `offline_access` is on
 * when the client asked — MCP clients add it themselves; we do not force it.
 */
export function defaultSelectedScopes(clientRequested: readonly string[]): string[] {
  const requested = new Set(clientRequested)
  const selected = new Set<string>(MCP_FIRST_CONNECT_SCOPES)
  for (const scope of API_KEY_SCOPES) {
    if (requested.has(scope)) selected.add(scope)
  }
  if (requested.has('offline_access')) selected.add('offline_access')
  return [...selected]
}

/** Space-separated grant: identity + the user's toggles, in AS catalogue order. */
export function consentGrantScope(selected: Iterable<string>): string {
  const chosen = new Set<string>([...selected, ...expandWriteGrants(selected)])
  for (const scope of MCP_IDENTITY_SCOPES) chosen.add(scope)
  return MCP_AS_SCOPES.filter((scope) => chosen.has(scope)).join(' ')
}

export function hasCapabilityGrant(selected: Iterable<string>): boolean {
  const chosen = new Set(selected)
  return API_KEY_SCOPES.some((scope) => chosen.has(scope))
}
