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

/**
 * MCP first-connect grant (RFC 9728 `scopes_supported` + 401 `scope=`).
 * Write scopes stay on the authorization server so a client can step up.
 */
export const MCP_FIRST_CONNECT_SCOPES = [
  'read:feedback',
  'read:article',
  'read:chat',
] as const satisfies readonly ApiKeyScope[]

/** Identity + refresh + the full capability catalogue — AS allow-list. */
export const MCP_AS_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  ...API_KEY_SCOPES,
] as const

/** Shared empty-selection message (zod schema, key service, creation dialog). */
export const EMPTY_SCOPES_MESSAGE = 'Select at least one scope'

export type AccessDomainId = 'feedback' | 'changelog' | 'article' | 'chat'
export type DomainAccessKind = 'read_write' | 'write_only'
export type DomainAccessLevel = 'off' | 'read' | 'read_write' | 'write'
export type DomainAccessChip = 'read' | 'read_write' | 'write'
export type DomainAccessLevels = Record<AccessDomainId, DomainAccessLevel>

export interface AccessDomain {
  domain: AccessDomainId
  label: string
  description: string
  kind: DomainAccessKind
  readScope: ApiKeyScope | null
  writeScope: ApiKeyScope
}

/**
 * Picker rows. Feedback / Help Center / Conversations are read-or-read-write;
 * changelog is write-only (its reads already ride `read:feedback`).
 */
export const ACCESS_DOMAINS: readonly AccessDomain[] = [
  {
    domain: 'feedback',
    label: 'Feedback',
    description: 'Posts, comments, boards, and roadmaps',
    kind: 'read_write',
    readScope: 'read:feedback',
    writeScope: 'write:feedback',
  },
  {
    domain: 'changelog',
    label: 'Changelog',
    description: 'Changelog entries and releases',
    kind: 'write_only',
    readScope: null,
    writeScope: 'write:changelog',
  },
  {
    domain: 'article',
    label: 'Help Center',
    description: 'Categories and articles',
    kind: 'read_write',
    readScope: 'read:article',
    writeScope: 'write:article',
  },
  {
    domain: 'chat',
    label: 'Conversations',
    description: 'Support inbox conversations and messages',
    kind: 'read_write',
    readScope: 'read:chat',
    writeScope: 'write:chat',
  },
]

function emptyDomainAccessLevels(): DomainAccessLevels {
  return { feedback: 'off', changelog: 'off', article: 'off', chat: 'off' }
}

/** The write sibling of a read scope, when that write exists in the vocabulary. */
function writeSiblingOfRead(scope: string): ApiKeyScope | null {
  if (!scope.startsWith('read:')) return null
  const write = `write:${scope.slice(5)}`
  return API_KEY_SCOPES.includes(write as ApiKeyScope) ? (write as ApiKeyScope) : null
}

/**
 * Issue-time expansion: holding `write:X` also stores `read:X` when that read
 * exists. `write:changelog` has no sibling read — changelog reads ride
 * `read:feedback` and are not implied.
 */
export function expandWriteGrants(scopes: Iterable<string>): ApiKeyScope[] {
  const held = new Set(scopes)
  for (const scope of [...held]) {
    if (!scope.startsWith('write:')) continue
    const read = `read:${scope.slice(6)}`
    if (API_KEY_SCOPES.includes(read as ApiKeyScope)) held.add(read)
  }
  return orderScopes(held)
}

/** Map stored / requested scopes onto picker levels. Write implies read in-UI. */
export function domainAccessLevels(scopes: Iterable<string>): DomainAccessLevels {
  const held = new Set(scopes)
  const levels = emptyDomainAccessLevels()
  for (const domain of ACCESS_DOMAINS) {
    if (domain.kind === 'write_only') {
      levels[domain.domain] = held.has(domain.writeScope) ? 'write' : 'off'
      continue
    }
    if (held.has(domain.writeScope)) levels[domain.domain] = 'read_write'
    else if (domain.readScope && held.has(domain.readScope)) levels[domain.domain] = 'read'
  }
  return levels
}

/** Inverse of `domainAccessLevels` — `read_write` stores both halves. */
export function scopesFromDomainLevels(levels: DomainAccessLevels): ApiKeyScope[] {
  const scopes: string[] = []
  for (const domain of ACCESS_DOMAINS) {
    const level = levels[domain.domain]
    if (level === 'read' && domain.readScope) scopes.push(domain.readScope)
    if (level === 'read_write') {
      if (domain.readScope) scopes.push(domain.readScope)
      scopes.push(domain.writeScope)
    }
    if (level === 'write') scopes.push(domain.writeScope)
  }
  return orderScopes(scopes)
}

/**
 * Chip click: selected chip again → off; Read while Read-and-write → downgrade;
 * otherwise select the clicked level.
 */
export function toggleDomainLevel(
  current: DomainAccessLevel,
  chip: DomainAccessChip
): DomainAccessLevel {
  if (chip === current) return 'off'
  return chip
}

/** One-line list summary. Null scopes = pre-scope-selection key. */
export function summarizeDomainAccess(scopes: readonly ApiKeyScope[] | null | undefined): string {
  if (scopes == null) return 'Full access (legacy)'
  if (scopes.length === 0) return 'No API scopes'
  const levels = domainAccessLevels(scopes)
  const allOn = ACCESS_DOMAINS.every((domain) =>
    domain.kind === 'write_only'
      ? levels[domain.domain] === 'write'
      : levels[domain.domain] === 'read_write'
  )
  if (allOn) return 'All scopes'
  const parts: string[] = []
  for (const domain of ACCESS_DOMAINS) {
    const level = levels[domain.domain]
    if (level === 'read') parts.push(`${domain.label} (read)`)
    else if (level === 'read_write') parts.push(`${domain.label} (read and write)`)
    else if (level === 'write') parts.push(`${domain.label} (write)`)
  }
  return parts.join(', ')
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
 * assistant configuration, not conversation access. Status page
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

/**
 * The read scope for a permission category — the capability an app/API key needs
 * to RECEIVE data in that category (an event subscription is a read). Events
 * declare a PermissionCategory and derive their required scope through here, so
 * events, permissions, and API-key scopes all resolve through the same
 * CATEGORY_SCOPES source of truth rather than a parallel vocabulary.
 */
export function readScopeForCategory(category: PermissionCategory): ApiKeyScope {
  return CATEGORY_SCOPES[category].read
}

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

/**
 * Whether a key's scope set (null/undefined = legacy full authority) holds a
 * scope. Same-domain write includes read (`write:feedback` satisfies
 * `read:feedback`). `write:changelog` does not imply `read:feedback` — there
 * is no `read:changelog`. Read never implies write.
 */
export function hasApiScope(scopes: readonly string[] | null | undefined, scope: string): boolean {
  if (scopes == null) return true
  if (scopes.includes(scope)) return true
  const write = writeSiblingOfRead(scope)
  return write != null && scopes.includes(write)
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
  const held = [...scopes]
  return new Set([...permissions].filter((p) => hasApiScope(held, scopeForPermission(p))))
}
