/**
 * Keep every registered OAuth client allowed the whole MCP scope catalogue.
 *
 * Authorize widens every request to the full catalogue so consent can offer
 * each scope, and the plugin refuses an authorize request with `invalid_scope`
 * when the client row does not list every requested scope. A client registered
 * before a scope joined the catalogue would therefore fail every authorize, so
 * each auth construction appends whatever the stored list lacks. What a token
 * may do stays bounded by the user's consent and the resource's allowed scopes.
 *
 * A NULL `scopes` falls back to the server-wide list in the plugin and stays
 * NULL. A row that already covers the catalogue is not rewritten.
 */
import { sql, type SQL } from 'drizzle-orm'
import { logger } from '@/lib/server/logger'
import { MCP_AS_SCOPES } from '@/lib/shared/api-key-scopes'

/** `ARRAY[...]::text[]` with one bound parameter per scope. */
function textArray(values: readonly string[]): SQL {
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )}]::text[]`
}

/**
 * Appends each catalogue scope a row lacks, in catalogue order. The WHERE
 * guard skips NULL rows and rows that already cover the catalogue.
 */
function mcpOauthClientScopesUpdate(scopes: readonly string[]): SQL {
  return sql`UPDATE "oauth_client"
    SET "scopes" = "scopes" || ARRAY(
      SELECT s FROM unnest(${textArray(scopes)}) WITH ORDINALITY AS c(s, i)
      WHERE NOT (s = ANY("scopes"))
      ORDER BY i
    ), "updated_at" = now()
    WHERE "scopes" IS NOT NULL AND NOT ("scopes" @> ${textArray(scopes)})`
}

/**
 * Never throws: a failure is logged and the stored lists stay as they were,
 * because a throw during auth construction breaks sign-in for the workspace.
 */
export async function reconcileMcpOauthClientScopes(opts: {
  db: { execute: (query: SQL) => Promise<unknown> }
  scopes?: readonly string[]
  log?: Pick<typeof logger, 'warn'>
}): Promise<void> {
  try {
    await opts.db.execute(mcpOauthClientScopesUpdate(opts.scopes ?? MCP_AS_SCOPES))
  } catch (error) {
    const log = opts.log ?? logger
    log.warn({ err: error }, 'could not widen OAuth client scopes to the MCP scope catalogue')
  }
}
