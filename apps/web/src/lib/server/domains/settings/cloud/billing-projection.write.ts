import type { StoredCloudConfig } from '@/lib/shared/db-types'
import { db, eq, settings } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { invalidateSettingsCache } from '../settings.helpers'
import { invalidateTierLimitsCache } from '../tier-limits.service'
import { parseBillingProjection, type BillingProjection } from './billing-projection'
import { decideProjectionWrite, expectedWorkspaceKey } from './projection-write'

const log = logger.child({ component: 'billing-projection' })

export class BillingProjectionWriteError extends Error {
  constructor(
    readonly code:
      | 'workspace_mismatch'
      | 'workspace_identity_missing'
      | 'settings_missing'
      | 'stale_version'
      | 'version_conflict'
  ) {
    super(code)
    this.name = 'BillingProjectionWriteError'
  }
}

export function decideBillingProjectionWrite(
  current: BillingProjection | null,
  incoming: BillingProjection
): 'apply' | 'idempotent' {
  return decideProjectionWrite(current, incoming, (code) => new BillingProjectionWriteError(code))
}

export async function writeBillingProjection(
  workspaceKey: string,
  projection: BillingProjection
): Promise<{ applied: boolean; version: number }> {
  const expected = expectedWorkspaceKey()
  if (!expected) throw new BillingProjectionWriteError('workspace_identity_missing')
  if (workspaceKey !== expected) throw new BillingProjectionWriteError('workspace_mismatch')

  const applied = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: settings.id, cloud: settings.cloud, cloudRevision: settings.cloudRevision })
      .from(settings)
      .limit(1)
      .for('update')
    if (!row) throw new BillingProjectionWriteError('settings_missing')

    const current = parseBillingProjection(row.cloud?.projection)
    const decision = decideBillingProjectionWrite(current, projection)
    if (decision === 'idempotent') return false

    // The projection is the entire commercial state a workspace may retain.
    // Replacing the block also guarantees old local provider references cannot
    // survive a control-plane update.
    const cloud: StoredCloudConfig = { enabled: true, projection }
    await tx
      .update(settings)
      .set({ cloud, cloudRevision: row.cloudRevision + 1 })
      .where(eq(settings.id, row.id))
    return true
  })

  if (applied) {
    invalidateTierLimitsCache()
    await invalidateSettingsCache()
  }
  log.info(
    { workspace_key: workspaceKey, projection_version: projection.version, applied },
    applied ? 'billing projection applied' : 'billing projection replay accepted'
  )
  return { applied, version: projection.version }
}
