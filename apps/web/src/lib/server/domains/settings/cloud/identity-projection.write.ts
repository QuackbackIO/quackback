import { isDeepStrictEqual } from 'node:util'
import { db, eq, settings } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'
import { invalidateSettingsCache } from '../settings.helpers'
import { parseIdentityProjection, type IdentityProjection } from './identity-projection'

const log = logger.child({ component: 'identity-projection' })

export class IdentityProjectionWriteError extends Error {
  constructor(
    readonly code:
      | 'workspace_mismatch'
      | 'workspace_identity_missing'
      | 'settings_missing'
      | 'stale_version'
      | 'version_conflict'
  ) {
    super(code)
    this.name = 'IdentityProjectionWriteError'
  }
}

export function decideIdentityProjectionWrite(
  current: IdentityProjection | null,
  incoming: IdentityProjection
): 'apply' | 'idempotent' {
  if (!current) return 'apply'
  if (incoming.version < current.version) throw new IdentityProjectionWriteError('stale_version')
  if (incoming.version > current.version) return 'apply'
  if (isDeepStrictEqual(incoming, current)) return 'idempotent'
  throw new IdentityProjectionWriteError('version_conflict')
}

function expectedWorkspaceKey(): string | null {
  return getCurrentWorkspace()?.workspaceKey ?? process.env.QUACKBACK_INSTANCE_ID ?? null
}

export async function writeIdentityProjection(
  workspaceKey: string,
  projection: IdentityProjection
): Promise<{ applied: boolean; version: number }> {
  const expected = expectedWorkspaceKey()
  if (!expected) throw new IdentityProjectionWriteError('workspace_identity_missing')
  if (workspaceKey !== expected) throw new IdentityProjectionWriteError('workspace_mismatch')

  const applied = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: settings.id,
        cloudIdentity: settings.cloudIdentity,
        revision: settings.cloudIdentityRevision,
      })
      .from(settings)
      .limit(1)
      .for('update')
    if (!row) throw new IdentityProjectionWriteError('settings_missing')

    const current = parseIdentityProjection(row.cloudIdentity)
    if (decideIdentityProjectionWrite(current, projection) === 'idempotent') return false
    await tx
      .update(settings)
      .set({
        name: projection.displayName,
        cloudIdentity: projection,
        cloudIdentityRevision: row.revision + 1,
      })
      .where(eq(settings.id, row.id))
    return true
  })

  if (applied) await invalidateSettingsCache()
  log.info(
    { workspace_key: workspaceKey, projection_version: projection.version, applied },
    applied ? 'identity projection applied' : 'identity projection replay accepted'
  )
  return { applied, version: projection.version }
}
