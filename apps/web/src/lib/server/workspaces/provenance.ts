/**
 * Did this workspace arrive from a control plane, or did somebody install it?
 *
 * One question, asked of the workspace's own database rather than of its
 * hostname, its domain or its environment. A hostname is a routing fact that a
 * reverse proxy, a custom domain or a local `/etc/hosts` entry can all change;
 * this is a property of the data, written by whoever created the workspace.
 *
 * ## The fact, and where it actually lives
 *
 * Two homes, and BOTH are live. `settings.metadata.cloudTenant` is what
 * provisioning writes today: workspaces created by current code carry the stamp
 * there and have `cloud_workspace_key` NULL. `settings.cloud_workspace_key` is
 * the dedicated column added by migration 0251 (renamed in 0258, documented as
 * "NULL on self-hosted installs"), and older workspaces carry it as well as the
 * bag. So neither source is the "current" one and neither is a fallback: a
 * workspace is provisioned if either says so.
 *
 * Both are written by the control plane and by nothing in this codebase:
 * `grep` finds no writer, and `cloud_workspace_key` is deliberately absent from
 * the Drizzle schema (see `workspaces/TENANCY.md`), so no in-app setting, no
 * config file and no admin toggle can produce one. That last property is the
 * point. A flag anyone can flip decides nothing; a stamp only the creator can
 * write decides who the workspace belongs to.
 *
 * ## What this does and does not guarantee
 *
 * On a pooled fleet the stamp is a precondition of being served at all:
 * `evaluateFingerprint` refuses a database whose stamp is absent
 * (`stamp_missing`) or names another workspace, once per pool checkout. But
 * that check runs only in pooled mode, and in pooled mode this predicate never
 * reaches the query at all — an active workspace scope short-circuits it below.
 * So the fingerprint does NOT establish that a stamp is present on the path
 * that reads for one. This is a single-tenant question with a single-tenant
 * answer: a deployment provisioned as one database per workspace is expected to
 * carry a stamp, and whether every provisioning path in the control plane does
 * write one is a control-plane question, tracked there rather than assumed here.
 *
 * The direction below is what covers the gap. When the fact cannot be
 * determined, this answers "provisioned", because "self-hosted" is the answer
 * that hands a workspace to whoever arrives first.
 *
 * ## Reading it
 *
 * Through `to_jsonb(s) ->> 'cloud_workspace_key'`, exactly as `fingerprint.ts`
 * does, so the query still answers on a database that predates the column
 * instead of failing on an unknown name. `LIMIT 2` for the same reason
 * `fingerprint.ts` uses it: one round trip that distinguishes none, one and
 * "more than one", and a `settings` table that is not a singleton is a database
 * this code cannot reason about — picking an arbitrary row out of it is exactly
 * how the wrong workspace answers a question about ownership.
 *
 * The metadata bag is parsed in TypeScript rather than cast to `jsonb` in SQL:
 * the column is `text` and a workspace holding malformed JSON there would make
 * the cast raise, turning a question about provenance into an outage.
 *
 * Errors are deliberately NOT caught. Every caller asks this in order to decide
 * whether to hand out authority, and a caller that could not read the answer
 * must not act as though the answer were "no". The same rule governs a bag that
 * reads but does not parse — see {@link hasMetadataStamp}.
 */
import { sql } from '@/lib/server/db'
import type { Database, Transaction } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { getCurrentWorkspace } from './workspace-context'
import { WORKSPACE_FINGERPRINT_METADATA_KEY } from './vendor/contract'

const log = logger.child({ component: 'workspace-provenance' })

/** The live db or an open transaction. */
type Executor = Database | Transaction

interface ProvenanceRow {
  stamp_column: string | null
  metadata: string | null
}

/**
 * True when a control plane claimed this database as one of its workspaces.
 *
 * Pass the transaction when the answer is about to be acted on inside one, so
 * the read shares that transaction's snapshot and its locks rather than racing
 * them from a second connection.
 */
export async function isProvisionedWorkspace(exec: Executor): Promise<boolean> {
  if (getCurrentWorkspace()) return true

  const result = await exec.execute(sql`
    SELECT (to_jsonb(s) ->> 'cloud_workspace_key') AS stamp_column,
           s.metadata                              AS metadata
      FROM settings s
     LIMIT 2
  `)
  const rows = result as unknown as ProvenanceRow[]

  // No settings row: an install nobody has set up yet, which is the product's
  // normal first run and genuinely not provisioned.
  if (rows.length === 0) return false

  // More than one: this schema holds a single workspace, so a second row means
  // something merged two databases or a migration went sideways. There is no
  // honest answer, and the dishonest one is the one that opens the workspace.
  if (rows.length > 1) {
    log.error(
      { settings_rows: rows.length },
      'settings is not a singleton; treating this workspace as provisioned'
    )
    return true
  }

  const row = rows[0]!
  if (nonEmpty(row.stamp_column)) return true
  return hasMetadataStamp(row.metadata)
}

function nonEmpty(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Presence of the stamp key, not its validity.
 *
 * A stamp the fingerprint would reject is still a control plane having claimed
 * this database, and the two live shapes disagree inside the bag (one names the
 * workspace `workspaceKey`, the older one `tenantId`) while both declaring
 * `v: 1`. Judging the shape here would let a stamp this code does not recognise
 * read as "self-hosted", which is the one answer that hands the workspace to a
 * stranger. So the question is only whether the key is there.
 *
 * A bag that does not parse answers "provisioned" for exactly the same reason,
 * and this is the direction that matters most: `telemetry/instance-id.ts` does
 * a read-modify-write of this whole column, and the workspaces provisioned by
 * current code carry their stamp ONLY here. A bag that came back unreadable is
 * not evidence that no stamp is in it — it is evidence that nobody can tell,
 * and "nobody can tell" must not resolve to "yours for the taking".
 */
function hasMetadataStamp(metadata: string | null): boolean {
  if (!metadata || metadata.trim() === '') return false
  let bag: unknown
  try {
    bag = JSON.parse(metadata)
  } catch {
    log.error(
      { reason: 'unparseable' },
      'settings.metadata cannot be read; treating this workspace as provisioned'
    )
    return true
  }
  if (typeof bag !== 'object' || bag === null) {
    log.error(
      { reason: 'not_an_object' },
      'settings.metadata cannot be read; treating this workspace as provisioned'
    )
    return true
  }
  const raw = (bag as Record<string, unknown>)[WORKSPACE_FINGERPRINT_METADATA_KEY]
  return raw !== undefined && raw !== null
}
