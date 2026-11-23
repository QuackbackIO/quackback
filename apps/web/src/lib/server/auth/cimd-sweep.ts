/**
 * CIMD client sweep: a daily job that deletes client rows a Client ID Metadata
 * Document created but nobody went on to use.
 *
 * A CIMD client row is written when an authorization request names an HTTPS
 * `client_id` whose document validates, before anyone sees the consent screen
 * (`cimd.ts`). Anyone who can host a JSON document can therefore add rows, and
 * a person who opens the consent screen and walks away leaves one too. Rows
 * nobody consented to are not needed: the next authorization request for that
 * `client_id` fetches the document again and recreates the row.
 *
 * A row is deleted only when all of these hold:
 * - it belongs to the CIMD discovery (DCR and admin-created clients are never
 *   touched);
 * - nobody holds a consent for it;
 * - it has no unrevoked, unexpired access or refresh token, because
 *   `forgetConsentFor` deletes consent when a client's redirect URIs change
 *   while its tokens stay valid, and deleting the client would cascade to them;
 * - it was created and last refreshed more than `CIMD_SWEEP_GRACE_MS` ago, so
 *   a consent screen someone has open is never pulled out from under them.
 *
 * The checks and the delete are one statement.
 */
import { db, sql } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { CIMD_CLIENT_DISCOVERY_ID } from './cimd'

const log = logger.child({ component: 'cimd-sweep' })

/** How long an unconsented CIMD client is kept: well past any consent screen. */
export const CIMD_SWEEP_GRACE_MS = 24 * 60 * 60 * 1000

export interface CimdSweepResult {
  deleted: number
}

export async function sweepUnconsentedCimdClients(opts?: {
  graceMs?: number
  batchSize?: number
}): Promise<CimdSweepResult> {
  const graceMs = opts?.graceMs ?? CIMD_SWEEP_GRACE_MS
  const batchSize = opts?.batchSize ?? 500
  const cutoff = new Date(Date.now() - graceMs).toISOString()

  const rows = await db.execute(sql`
    DELETE FROM oauth_client c
    WHERE c.id IN (
      SELECT oc.id FROM oauth_client oc
      WHERE oc.client_discovery_id = ${CIMD_CLIENT_DISCOVERY_ID}
        AND oc.created_at < ${cutoff}::timestamptz
        AND coalesce(oc.updated_at, oc.created_at) < ${cutoff}::timestamptz
        AND NOT EXISTS (SELECT 1 FROM oauth_consent x WHERE x.client_id = oc.client_id)
        AND NOT EXISTS (
          SELECT 1 FROM oauth_access_token t
          WHERE t.client_id = oc.client_id
            AND t.revoked IS NULL
            AND (t.expires_at IS NULL OR t.expires_at > now())
        )
        AND NOT EXISTS (
          SELECT 1 FROM oauth_refresh_token t
          WHERE t.client_id = oc.client_id
            AND t.revoked IS NULL
            AND (t.expires_at IS NULL OR t.expires_at > now())
        )
      ORDER BY oc.created_at
      LIMIT ${batchSize}
    )
    RETURNING c.client_id
  `)
  const deleted = (rows as unknown as Array<{ client_id: string }>).map((r) => r.client_id)
  if (deleted.length > 0) {
    log.info({ count: deleted.length, clientIds: deleted }, 'deleted unconsented CIMD clients')
  }
  return { deleted: deleted.length }
}

/** Job handler (`jobs/definitions.ts`). */
export async function runCimdSweep(): Promise<void> {
  await sweepUnconsentedCimdClients()
}
