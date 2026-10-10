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
 * Their documented workaround until that ships: insert the row with
 * `ON CONFLICT DO NOTHING` so `findOne` hits and `create` is never attempted.
 * There is no config flag that disables the seed.
 *
 * A static migration cannot do this for us: the identifier is the workspace
 * origin (`https://<slug>.quackback.io/api/mcp`), not a fleet-wide constant.
 */

type OauthResourceTable = { identifier: unknown }

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
   * insert → values → onConflictDoNothing chain rather than `typeof db`.
   */
  db: {
    insert: (table: OauthResourceTable) => {
      values: (row: ReturnType<typeof mcpOauthResourceSeedRow>) => {
        onConflictDoNothing: (args: { target: unknown }) => Promise<unknown>
      }
    }
  }
  table: OauthResourceTable
  identifier: string
  allowedScopes: readonly string[]
}): Promise<void> {
  await opts.db
    .insert(opts.table)
    .values(mcpOauthResourceSeedRow(opts.identifier, opts.allowedScopes))
    .onConflictDoNothing({ target: opts.table.identifier })
}
