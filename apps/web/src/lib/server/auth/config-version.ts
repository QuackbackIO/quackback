/**
 * Cross-pod auth-instance invalidation via a monotonic version counter.
 *
 * Each pod records the `settings.auth_config_version` it built its
 * Better-Auth instance against. On every request the proxy compares
 * the cached instance's version with the current value (read off the
 * existing settings cache) and calls `resetAuth()` on mismatch.
 *
 * Mutation is always atomic SQL `auth_config_version = auth_config_version + 1`
 * so concurrent writers each land a unique version — a read-then-write
 * pattern would let two writers both land `n+1` and pod-B cached at
 * `n+1` after writer A would never notice writer B.
 */

import { sql } from 'drizzle-orm'
import { db, settings } from '@/lib/server/db'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Atomically bump `settings.auth_config_version` inside the caller's
 * transaction. The caller invalidates the settings cache after commit
 * (typically via `invalidateSettingsCache()` in settings.helpers).
 */
export async function bumpAuthConfigVersionInTx(tx: Tx): Promise<void> {
  await tx.update(settings).set({ authConfigVersion: sql`${settings.authConfigVersion} + 1` })
}
