/**
 * Pre-insert the MCP protected-resource row so Better Auth's boot-time seed
 * does not try to create it.
 *
 * Better Auth 1.7 `mcp()` seeds `oauth_resource` from config on every
 * `createAuth()`. The seed is supposed to treat a UNIQUE collision as a no-op
 * (another replica already inserted the identifier), but it matches
 * `/unique|duplicate/` against `err.message`. Drizzle wraps the driver error
 * as `Failed query: insert into "oauth_resource"…` and puts SQLSTATE 23505 on
 * `cause`, so the guard misses, plugin init throws, and `getAuth()` fails —
 * which is how portal sign-in started returning "Failed to send sign-in email".
 *
 * Upstream: https://github.com/better-auth/better-auth/issues/11034
 * (fix in https://github.com/better-auth/better-auth/pull/11087, unreleased).
 * Their documented workaround until that ships: insert the row ahead of the
 * seed, ignoring a conflict, so `findOne` hits and `create` is never attempted.
 * There is no config flag that disables the seed.
 *
 * A static migration cannot do this for us: the identifier is the workspace
 * origin (`https://<slug>.quackback.io/api/mcp`), not a fleet-wide constant.
 *
 * An existing row has its `allowedScopes` brought up to date. Better Auth
 * intersects every token's scopes with that column, so a row left as it was
 * first seeded silently strips any scope added to the vocabulary since, and
 * the tools behind it are refused whatever the person consented to.
 */
import { sql } from 'drizzle-orm'

type OauthResourceTable = { identifier: unknown; allowedScopes: unknown }

export function mcpOauthResourceSeedRow(identifier: string, allowedScopes: readonly string[]) {
  const now = new Date()
  return {
    id: crypto.randomUUID(),
    identifier,
    name: identifier,
    allowedScopes: [...allowedScopes],
    dpopBoundAccessTokensRequired: false,
    disabled: false,
    policyVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
}

export async function ensureMcpOauthResource(opts: {
  /**
   * Drizzle's insert builder is invariant in the row type, so this is the
   * insert → values → onConflictDoUpdate chain rather than `typeof db`.
   */
  db: {
    insert: (table: OauthResourceTable) => {
      values: (row: ReturnType<typeof mcpOauthResourceSeedRow>) => {
        onConflictDoUpdate: (args: {
          target: unknown
          set: { allowedScopes: string[]; updatedAt: Date }
          setWhere: unknown
        }) => Promise<unknown>
      }
    }
  }
  table: OauthResourceTable
  identifier: string
  allowedScopes: readonly string[]
}): Promise<void> {
  const row = mcpOauthResourceSeedRow(opts.identifier, opts.allowedScopes)
  await opts.db
    .insert(opts.table)
    .values(row)
    .onConflictDoUpdate({
      target: opts.table.identifier,
      set: { allowedScopes: row.allowedScopes, updatedAt: row.updatedAt },
      // Leave a row that already matches untouched: this runs on every boot.
      setWhere: sql`${opts.table.allowedScopes} is distinct from excluded.allowed_scopes`,
    })
}
