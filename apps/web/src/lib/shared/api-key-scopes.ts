/**
 * API-key capability scopes — the single vocabulary shared by the MCP server,
 * the public REST API, and the key-creation UI.
 *
 * A key's authority is its owner's permission set INTERSECTED with the key's
 * stored scopes (the personal-access-token model). Keys created before scope
 * selection existed carry a NULL scopes column and keep full owner authority;
 * the admin UI labels them "Full access (legacy)".
 *
 * Pure data and pure functions only — no server-side imports — so client
 * bundles (the key-creation UI) can consume the vocabulary directly.
 */
import {
  PERMISSION_CATALOGUE,
  type PermissionKey,
  type PermissionCategory,
} from '@/lib/shared/permissions'

export const API_KEY_SCOPES = [
  'read:feedback',
  'write:feedback',
  'write:changelog',
  'read:article',
  'write:article',
  'read:chat',
  'write:chat',
] as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

/** Shared empty-selection message (zod schema, key service, creation dialog). */
export const EMPTY_SCOPES_MESSAGE = 'Select at least one scope'

/** Human labels for the key-creation UI checkbox set. */
export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
  'read:feedback': 'Read feedback',
  'write:feedback': 'Write feedback',
  'write:changelog': 'Write changelog',
  'read:article': 'Read help center',
  'write:article': 'Write help center',
  'read:chat': 'Read conversations',
  'write:chat': 'Write conversations',
}

/**
 * Permission-to-scope mapping, one row per catalogue category.
 *
 * The REST API gates on catalogue permissions while MCP gates on scopes; this
 * table joins the two vocabularies. Feedback is the base domain: directory and
 * workspace families (people, members, segments, webhooks, integrations, ...)
 * ride the feedback scopes because they exist on the REST surface as feedback
 * integration plumbing. Changelog READS ride `read:feedback` — there is no
 * read:changelog scope, matching the MCP search / get_details convention.
 * Support (tickets) shares the chat scopes with conversations. AI rides the
 * feedback scopes like the other workspace-config families: its keys gate
 * assistant/connector configuration, not conversation access. Status page
 * rides the feedback scopes too — `/api/v1/status/*` (Status Product Spec
 * §10) has no dedicated REST scope of its own, same rationale as changelog.
 */
const CATEGORY_SCOPES: Record<PermissionCategory, { read: ApiKeyScope; write: ApiKeyScope }> = {
  workspace: { read: 'read:feedback', write: 'write:feedback' },
  members: { read: 'read:feedback', write: 'write:feedback' },
  people: { read: 'read:feedback', write: 'write:feedback' },
  company: { read: 'read:feedback', write: 'write:feedback' },
  audience: { read: 'read:feedback', write: 'write:feedback' },
  feedback: { read: 'read:feedback', write: 'write:feedback' },
  changelog: { read: 'read:feedback', write: 'write:changelog' },
  help_center: { read: 'read:article', write: 'write:article' },
  survey: { read: 'read:feedback', write: 'write:feedback' },
  conversation: { read: 'read:chat', write: 'write:chat' },
  analytics: { read: 'read:feedback', write: 'write:feedback' },
  integration: { read: 'read:feedback', write: 'write:feedback' },
  support: { read: 'read:chat', write: 'write:chat' },
  ai: { read: 'read:feedback', write: 'write:feedback' },
  status_page: { read: 'read:feedback', write: 'write:feedback' },
}

const CATEGORY_BY_KEY = new Map<PermissionKey, PermissionCategory>(
  PERMISSION_CATALOGUE.map((e) => [e.key, e.category])
)

/** Verbs that read data without mutating it (`post.export` produces a download). */
const READ_VERBS = new Set(['view', 'view_private', 'view_all', 'view_draft', 'export'])

/** The scope an API key must hold for a catalogue permission to apply. */
export function scopeForPermission(permission: PermissionKey): ApiKeyScope {
  // Every catalogue key has a category; fall back to the base write scope so an
  // unmapped permission fails toward requiring MORE authority, never less.
  const category = CATEGORY_BY_KEY.get(permission) ?? 'feedback'
  const verb = permission.split('.')[1] ?? ''
  const domain = CATEGORY_SCOPES[category]
  return READ_VERBS.has(verb) ? domain.read : domain.write
}

/**
 * Parse the stored `api_keys.scopes` column into the key's effective scope set.
 *
 * - NULL, or an empty stored array → `null`: a legacy full-authority key
 *   (created before scope selection existed). Callers treat null as all scopes.
 * - A non-empty array → the vocabulary entries it contains. Entries outside the
 *   vocabulary (internal capability scopes such as `internal:tier-limits`)
 *   grant nothing on the general API, so a purely internal key resolves to `[]`
 *   — scoped, with no general-API authority. Malformed JSON also fails closed
 *   to `[]`.
 */
export function parseApiKeyScopes(raw: string | null): ApiKeyScope[] | null {
  if (raw === null) return null
  const parsed = parseScopesJson(raw)
  if (parsed === null) return []
  if (parsed.length === 0) return null
  return orderScopes(parsed.filter((s): s is string => typeof s === 'string'))
}

/**
 * Parse the raw stored scopes JSON to its array entries; malformed or
 * non-array input fails closed to null. Shared by parseApiKeyScopes and the
 * key service's internal scope check (which keeps its own non-vocabulary +
 * fail-closed semantics for internal capability scopes).
 */
export function parseScopesJson(raw: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** The vocabulary entries present in `scopes`, deduped, in vocabulary order. */
export function orderScopes(scopes: Iterable<string>): ApiKeyScope[] {
  const held = new Set(scopes)
  return API_KEY_SCOPES.filter((s) => held.has(s))
}

/** Whether a key's scope set (null/undefined = legacy full authority) holds a scope. */
export function hasApiScope(
  scopes: readonly ApiKeyScope[] | null | undefined,
  scope: ApiKeyScope
): boolean {
  return scopes == null || scopes.includes(scope)
}

/**
 * A key's effective scope set for MCP: its stored scopes, or the full
 * vocabulary for legacy keys with none stored (same rule hasApiScope applies
 * on the REST side).
 */
export function effectiveScopes(stored: readonly ApiKeyScope[] | null | undefined): ApiKeyScope[] {
  return stored == null ? [...API_KEY_SCOPES] : [...stored]
}

/** Filter a permission set to the permissions whose mapped scope is held. */
export function permissionsWithinScopes(
  permissions: ReadonlySet<PermissionKey>,
  scopes: ReadonlySet<ApiKeyScope>
): Set<PermissionKey> {
  return new Set([...permissions].filter((p) => scopes.has(scopeForPermission(p))))
}
