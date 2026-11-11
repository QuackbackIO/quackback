import {
  ACCESS_DOMAINS,
  API_KEY_SCOPES,
  MCP_AS_SCOPES,
  MCP_FIRST_CONNECT_SCOPES,
  domainAccessLevels,
  expandWriteGrants,
  type DomainAccessLevels,
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

function isFullAsCatalogue(raw: string): boolean {
  const held = new Set(parseScopeList(raw))
  return held.size === MCP_AS_SCOPES.length && MCP_AS_SCOPES.every((scope) => held.has(scope))
}

/** The AS allow-list, in catalogue order — what consent is allowed to grant. */
export function expandAuthorizeScopes(): string {
  return MCP_AS_SCOPES.join(' ')
}

/**
 * What the client asked for, used only to prefill the page.
 * After authorize rewrite, that lives on `qb_requested_scope`. If the
 * consent URL was expanded but the param is missing, the full catalogue
 * `scope=` is our own rewrite, not a request, so it reads as a plain connect.
 */
export function clientRequestedFromConsentSearch(params: {
  requested?: string
  scope?: string
}): string[] {
  if (params.requested !== undefined) return parseScopeList(params.requested)
  if (isFullAsCatalogue(params.scope ?? '')) return [...MCP_FIRST_CONNECT_SCOPES]
  return parseScopeList(params.scope)
}

/**
 * Better Auth refuses any consent grant that was not on the authorize
 * request, and a client may have asked for less than the person wants to
 * give (an older client that cached a reads-only challenge, or one that reads
 * RFC 9728 `scopes_supported`). Expand `scope` to the full allow-list so the
 * consent page can grant any of it; keep the original request for defaults.
 *
 * A client-supplied `qb_requested_scope` is ignored on the first hop — only
 * `scope=` is the request. The second pass is identified by `scope` already
 * being the catalogue, not by the param being present.
 */
export function rewriteMcpAuthorizeRequest(request: Request): Request {
  const url = new URL(request.url)
  if (!url.pathname.endsWith('/oauth2/authorize')) return request
  const scope = url.searchParams.get('scope') ?? ''
  if (isFullAsCatalogue(scope)) {
    if (url.searchParams.has(CLIENT_REQUESTED_SCOPE_PARAM)) return request
    url.searchParams.set(CLIENT_REQUESTED_SCOPE_PARAM, scope)
    return new Request(url, request)
  }
  url.searchParams.set(CLIENT_REQUESTED_SCOPE_PARAM, scope)
  url.searchParams.set('scope', expandAuthorizeScopes())
  return new Request(url, request)
}

/**
 * Prefill. A plain connect defaults to full access: most people connecting an
 * assistant want it to act, and a reads-only grant fails on the first write
 * in every client that cannot step up. A request that names writes for only
 * some areas is a deliberate narrower ask (a step-up), so it prefills the
 * reads plus exactly those writes. `offline_access` is on when the client
 * asked — MCP clients add it themselves; we do not force it.
 */
export function defaultSelectedScopes(clientRequested: readonly string[]): string[] {
  const requested = new Set(clientRequested)
  const namesWrite = API_KEY_SCOPES.some((s) => s.startsWith('write:') && requested.has(s))
  const selected = new Set<string>(namesWrite ? MCP_FIRST_CONNECT_SCOPES : API_KEY_SCOPES)
  for (const scope of API_KEY_SCOPES) {
    if (requested.has(scope)) selected.add(scope)
  }
  if (requested.has('offline_access')) selected.add('offline_access')
  return [...selected]
}

/** The one-click choices on the consent page; `custom` is any other selection. */
export type ConsentPreset = 'full' | 'read' | 'custom'

/** Picker levels for a one-click choice. */
export function consentPresetLevels(preset: Exclude<ConsentPreset, 'custom'>): DomainAccessLevels {
  return domainAccessLevels(
    preset === 'full' ? API_KEY_SCOPES : API_KEY_SCOPES.filter((s) => s.startsWith('read:'))
  )
}

/** Which choice a selection amounts to. */
export function consentPreset(levels: DomainAccessLevels): ConsentPreset {
  for (const preset of ['full', 'read'] as const) {
    const target = consentPresetLevels(preset)
    if (ACCESS_DOMAINS.every((d) => levels[d.domain] === target[d.domain])) return preset
  }
  return 'custom'
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
