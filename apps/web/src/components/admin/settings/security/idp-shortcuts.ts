/**
 * Per-IdP shortcut inputs that build the OIDC discovery URL from the
 * one or two pieces of information that vary per customer (Okta org
 * subdomain, Auth0 tenant, Microsoft Entra tenant ID, Keycloak base +
 * realm). The discovery URL field stays editable directly as the
 * canonical OIDC input — these shortcuts are a typo-resistant way to
 * fill it for known IdPs.
 *
 * Pattern lifted from WorkOS / Stytch admin UIs: pick IdP, enter the
 * single varying piece, we construct the well-formed URL.
 */

export type IdpKind = 'okta' | 'auth0' | 'keycloak' | 'entra' | 'google' | 'other'

/** Friendly display name per IdP kind — the picker tiles and the provider list
 *  both render these, so they live here to stay in sync. */
export const IDP_KIND_NAMES: Record<IdpKind, string> = {
  okta: 'Okta',
  auth0: 'Auth0',
  entra: 'Microsoft Entra',
  keycloak: 'Keycloak',
  google: 'Google Workspace',
  other: 'Custom OIDC',
}

export interface IdpShortcutField {
  /** Field key — used in the shortcut state shape and form input. */
  key: string
  label: string
  placeholder: string
  /** Help text shown under the input. */
  help?: string
}

export interface IdpShortcutDef {
  kind: IdpKind
  /** Inputs the admin fills in. Empty means no shortcut (Google
   *  Workspace = single fixed URL; "other" = paste discovery URL). */
  fields: IdpShortcutField[]
  /** Build the discovery URL from the shortcut input values. Returns
   *  null when the inputs are empty / incomplete (caller leaves the
   *  discovery URL field whatever it already was). */
  build: (values: Record<string, string>) => string | null
  /** Reverse: parse an existing discovery URL into shortcut field
   *  values, so admins editing a saved config see the shortcut
   *  pre-filled. Returns null when the URL doesn't match the pattern. */
  parse: (discoveryUrl: string) => Record<string, string> | null
}

const trim = (v: string) => (v || '').trim()

const OKTA: IdpShortcutDef = {
  kind: 'okta',
  fields: [
    {
      key: 'domain',
      label: 'Okta domain',
      placeholder: 'yourorg.okta.com',
    },
  ],
  build: (v) => {
    const d = trim(v.domain)
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
    if (!d) return null
    return `https://${d}/.well-known/openid-configuration`
  },
  parse: (url) => {
    const m = /^https:\/\/([^/]+)\/\.well-known\/openid-configuration$/.exec(url)
    if (!m) return null
    if (!/\.okta\.com$|\.oktapreview\.com$/.test(m[1])) return null
    return { domain: m[1] }
  },
}

const AUTH0: IdpShortcutDef = {
  kind: 'auth0',
  fields: [
    {
      key: 'domain',
      label: 'Auth0 domain',
      placeholder: 'yourtenant.us.auth0.com',
    },
  ],
  build: (v) => {
    const d = trim(v.domain)
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
    if (!d) return null
    return `https://${d}/.well-known/openid-configuration`
  },
  parse: (url) => {
    const m = /^https:\/\/([^/]+)\/\.well-known\/openid-configuration$/.exec(url)
    if (!m) return null
    if (!/\.auth0\.com$/.test(m[1])) return null
    return { domain: m[1] }
  },
}

const ENTRA: IdpShortcutDef = {
  kind: 'entra',
  fields: [
    {
      key: 'tenant',
      label: 'Tenant ID or domain',
      placeholder: 'acme.onmicrosoft.com  /  6045704a-f241-4b8d-99ba-...',
    },
  ],
  build: (v) => {
    const t = trim(v.tenant)
    if (!t) return null
    return `https://login.microsoftonline.com/${encodeURIComponent(t)}/v2.0/.well-known/openid-configuration`
  },
  parse: (url) => {
    const m =
      /^https:\/\/login\.microsoftonline\.com\/([^/]+)\/v2\.0\/\.well-known\/openid-configuration$/.exec(
        url
      )
    if (!m) return null
    return { tenant: decodeURIComponent(m[1]) }
  },
}

const KEYCLOAK: IdpShortcutDef = {
  kind: 'keycloak',
  fields: [
    {
      key: 'baseUrl',
      label: 'Keycloak base URL',
      placeholder: 'https://sso.acme.com',
    },
    {
      key: 'realm',
      label: 'Realm',
      placeholder: 'acme',
    },
  ],
  build: (v) => {
    const base = trim(v.baseUrl).replace(/\/$/, '')
    const realm = trim(v.realm)
    if (!base || !realm) return null
    const baseWithScheme = base.startsWith('http') ? base : `https://${base}`
    return `${baseWithScheme}/realms/${encodeURIComponent(realm)}/.well-known/openid-configuration`
  },
  parse: (url) => {
    const m = /^(https?:\/\/[^/]+)\/realms\/([^/]+)\/\.well-known\/openid-configuration$/.exec(url)
    if (!m) return null
    return { baseUrl: m[1], realm: decodeURIComponent(m[2]) }
  },
}

const GOOGLE: IdpShortcutDef = {
  kind: 'google',
  // Google Workspace's discovery URL is fixed across all customers —
  // workspace control happens via the `hd` (hosted-domain) parameter
  // on the auth request, not the discovery doc. No shortcut needed.
  fields: [],
  build: () => 'https://accounts.google.com/.well-known/openid-configuration',
  parse: (url) =>
    url === 'https://accounts.google.com/.well-known/openid-configuration' ? {} : null,
}

const OTHER: IdpShortcutDef = {
  kind: 'other',
  fields: [],
  build: () => null,
  parse: () => null,
}

const REGISTRY: Record<IdpKind, IdpShortcutDef> = {
  okta: OKTA,
  auth0: AUTH0,
  entra: ENTRA,
  keycloak: KEYCLOAK,
  google: GOOGLE,
  other: OTHER,
}

export function getIdpShortcut(kind: IdpKind): IdpShortcutDef {
  return REGISTRY[kind]
}

/**
 * Auto-detect the IdP kind from a discovery URL — used when an admin
 * loads the page with a saved config and we want to show the matching
 * shortcut pre-filled. Falls back to `other` for unrecognised URLs.
 */
export function inferIdpKind(discoveryUrl: string | undefined | null): IdpKind {
  if (!discoveryUrl) return 'other'
  if (OKTA.parse(discoveryUrl)) return 'okta'
  if (AUTH0.parse(discoveryUrl)) return 'auth0'
  if (ENTRA.parse(discoveryUrl)) return 'entra'
  if (KEYCLOAK.parse(discoveryUrl)) return 'keycloak'
  if (GOOGLE.parse(discoveryUrl)) return 'google'
  return 'other'
}
