/**
 * The application cache, on Postgres.
 *
 * Successor to `lib/server/redis.ts`'s `cacheGet`/`cacheSet`/`cacheDel`.
 * The call sites are unchanged: same three
 * helpers, same key table, same "a cache failure is a cache miss" contract.
 * What changed is where a row lands — `kv_store` in the workspace's own database
 * instead of a `t:<workspaceKey>:` key in a shared Redis.
 *
 * ## Failures are swallowed, deliberately, and that has a sharper edge here
 *
 * Every helper below logs and continues. That was already true of the Redis
 * version and the callers depend on it — `settings.service.ts` reads through
 * this on the SSR hot path and must not 500 because a cache is unavailable.
 *
 * The edge: under pooled tenancy `db` throws `WorkspaceScopeMissingError` when
 * there is no workspace scope, where Redis would have quietly used the `_`
 * namespace. So a cache call from an unscoped background context now degrades
 * to a permanent miss rather than reading a shared namespace. That is the
 * correct direction — a miss is slow, a shared namespace is one workspace's
 * settings served to another — but it means "the cache stopped working" is a
 * real state to look for in a new background subsystem, and the warn below is
 * where it shows up.
 */
import { logger } from '@/lib/server/logger'
import { kvGet, kvSet, kvDel } from '@/lib/server/kv/pg-kv'

const log = logger.child({ component: 'cache' })

/**
 * Logical cache key names.
 *
 * These are the strings that reach the `key` column verbatim. The workspace
 * discriminator is NOT part of them — it is `kv_store.workspace_key`, the leading
 * column of the primary key, written by `pg-kv.ts` from
 * `currentWorkspaceNamespace()`.
 *
 * That is a stronger arrangement than the prefix it replaces, for the reason
 * the old comment here gave: half of these names are built by concatenation at
 * the call site (`PRINCIPAL_BY_USER`, the SSO-test session keys, the
 * link-preview and unfurl keys), so a namespace applied by string building was
 * always one `${'settings:workspace'}:extra` away from being bypassed. A key
 * column cannot be bypassed by concatenation; the worst a malformed key can do
 * is collide with another key of the same workspace.
 */
export const CACHE_KEYS = {
  WORKSPACE_SETTINGS: 'settings:workspace',
  INTEGRATION_MAPPINGS: 'hooks:integration-mappings',
  // v2 invalidates rows cached before migration 0123 added the
  // conversation.csat_comment_added subscription.
  ACTIVE_WEBHOOKS: 'hooks:webhooks-active:v2',
  SLACK_CHANNELS: 'slack:channels',
  // Hot dependency of getWorkspaceSettings; invalidated by save/delete in
  // platform-credential.service.ts.
  PLATFORM_INTEGRATION_TYPES: 'platform-cred:configured-types',
  // The registered-auth-provider id list surfaced to the login UI on every
  // app bootstrap. Derived from identity_provider + sso_verified_domain +
  // authConfig.oauth; invalidated by invalidateSettingsCache() and by the
  // platform-credential save/delete flows. 5min TTL backstops anything missed.
  REGISTERED_AUTH_PROVIDERS: 'auth:registered-providers',
  // Per-user principal type/role lookup hit on every authenticated SSR
  // render. Invalidated by role/type mutations; 5min TTL backstops anything
  // we miss.
  PRINCIPAL_BY_USER: (userId: string) => `principal:user:${userId}` as const,
  CONNECTOR_CATALOG: 'assistant:connectors:catalog',
  SKILL_CATALOGUE: (agent: string) => `assistant:skills:catalogue:${agent}` as const,
} as const

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    return await kvGet<T>(key)
  } catch (err) {
    log.warn({ err, key }, 'cache get failed')
    return null
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await kvSet(key, value, ttlSeconds)
  } catch (err) {
    log.warn({ err, key }, 'cache set failed')
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  try {
    await kvDel(...keys)
  } catch (err) {
    log.warn({ err, keys }, 'cache del failed')
  }
}
