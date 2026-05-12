/**
 * Revoke active sessions for any team-role user whose primary
 * authentication wasn't via SSO. Invoked when an admin enables
 * `authConfig.ssoOidc.required` — without this, existing
 * password/magic-link sessions would keep their cookies and the
 * workspace-wide guard wouldn't bite until the next expiry.
 *
 * A user counts as "SSO-authenticated" when they have a row in
 * `account` with `provider_id='sso'`. The helper is a single SQL
 * DELETE so the work is atomic and fast even at thousands of
 * sessions per workspace.
 *
 * Returns the number of session rows deleted; callers decide whether
 * to record a `session.revoked.bulk` audit event with that count in
 * metadata.
 */
import { db } from '@/lib/server/db'
import { sql } from 'drizzle-orm'

export async function revokeNonSsoTeamSessions(): Promise<number> {
  // postgres-js's drizzle driver returns the row array directly with a
  // `.count` property for non-SELECT statements — not a `{ rowCount }`
  // object like node-postgres. Read `.count` (the affected-row count)
  // and fall back to the array length / 0 if the shape ever changes.
  const result = (await db.execute(sql`
    DELETE FROM "session"
    WHERE "user_id" IN (
      SELECT p."user_id"
      FROM "principal" p
      WHERE p."role" IN ('admin', 'member')
        AND p."user_id" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "account" a
          WHERE a."user_id" = p."user_id"
            AND a."provider_id" = 'sso'
        )
    )
  `)) as unknown as { count?: number; length?: number }
  return result.count ?? result.length ?? 0
}
