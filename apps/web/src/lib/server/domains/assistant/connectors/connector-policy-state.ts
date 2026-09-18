/**
 * Per-use policy state for one connector row.
 *
 * Split out of connectors.service.ts so the projection, its one-time
 * persistence and the seed for a newly assigned use sit together and can be
 * read without the CRUD around them. Every function here takes a row, so
 * nothing in this file needs to load one and the service keeps ownership of
 * reads and writes.
 */
import { eq, sql } from 'drizzle-orm'
import {
  db as defaultDb,
  connectors,
  type ConnectorProfilePolicies,
  type ConnectorToolReviews,
} from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import {
  projectSharedPoliciesToProfiles,
  CONNECTOR_POLICY_PROFILES,
  DEFAULT_CONNECTOR_PROFILE_POLICY,
  DEFAULT_CONNECTOR_TOOL_POLICIES,
  type ConnectorAssignments,
} from '@/lib/shared/assistant/connectors'
import { grandfatherToolReviews } from './catalog-review'

type ConnectorRow = typeof connectors.$inferSelect

/**
 * The per-use policies and reviewed contracts this row resolves under.
 *
 * Migration 0288 adds the columns but carries no backfill, because it has to
 * replay as a no-op. So a row written before the connection gate still has
 * NULL in both, and the projection happens here: the shared map goes to the
 * uses this connector is ALREADY assigned to, and the contracts its tools
 * already had are recorded as reviewed. Pure, so callers can use it to read
 * without writing; `ensureConnectorPolicyState` is the one that persists.
 */
export function effectiveConnectorPolicyState(row: ConnectorRow): {
  profilePolicies: ConnectorProfilePolicies
  toolReviews: ConnectorToolReviews
} {
  return {
    profilePolicies:
      row.profilePolicies ??
      projectSharedPoliciesToProfiles(
        row.toolPolicies ?? DEFAULT_CONNECTOR_TOOL_POLICIES,
        row.assignments
      ),
    toolReviews: row.toolReviews ?? grandfatherToolReviews(row.tools, row.catalogRevision),
  }
}

/**
 * Persist the projection above, once, the first time anything reads this row.
 *
 * Grandfathering has to be written down rather than derived on each read: a
 * derived baseline would be recomputed from whatever the catalog holds at that
 * moment, so a contract that changed after the gate shipped would keep looking
 * reviewed forever. `coalesce` makes the write race-safe, so a concurrent
 * reader that got there first keeps its value instead of being clobbered.
 */
export async function ensureConnectorPolicyState(
  row: ConnectorRow,
  execDb: Executor = defaultDb
): Promise<ConnectorRow> {
  if (row.profilePolicies != null && row.toolReviews != null) return row
  const projected = effectiveConnectorPolicyState(row)
  const [updated] = await execDb
    .update(connectors)
    .set({
      profilePolicies: sql`coalesce(${connectors.profilePolicies}, ${JSON.stringify(projected.profilePolicies)}::jsonb)`,
      toolReviews: sql`coalesce(${connectors.toolReviews}, ${JSON.stringify(projected.toolReviews)}::jsonb)`,
    })
    .where(eq(connectors.id, row.id))
    .returning()
  return updated ?? { ...row, ...projected }
}

/**
 * The policy records a connector starts with: one per assigned use, at the
 * recommended defaults, marked explicit because somebody chose these uses.
 * Nothing is written for a use that is not assigned, so an unassigned use
 * stays denied rather than inheriting a record it never had.
 */
export function seedProfilePolicies(assignments: ConnectorAssignments): ConnectorProfilePolicies {
  const seeded: ConnectorProfilePolicies = {}
  for (const profile of CONNECTOR_POLICY_PROFILES) {
    if (assignments[profile] !== true) continue
    seeded[profile] = { ...DEFAULT_CONNECTOR_PROFILE_POLICY, tools: {}, origin: 'explicit' }
  }
  return seeded
}
