import { ForbiddenError } from '@/lib/shared/errors'
import { isPathManaged } from './managed-paths'

/**
 * Throw 403 (ForbiddenError, code FIELD_MANAGED) if `path` is in the
 * workspace's managed-fields list.
 *
 * Threaded through every settings mutator that owns a managed-eligible
 * field. The actual managed-paths read is done via getTenantSettings()
 * — so the Redis cache backing it absorbs the per-mutator cost.
 */
export async function assertNotManaged(path: string): Promise<void> {
  const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')
  await _internalAssertNotManaged(path, async () => {
    const s = await getTenantSettings()
    return s?.managedFieldPaths ?? []
  })
}

/** Internal entry point exposed for direct testing without the
 *  getTenantSettings() round-trip. Production callers use
 *  `assertNotManaged`. */
export async function _internalAssertNotManaged(
  path: string,
  readPaths: () => Promise<string[]>
): Promise<void> {
  const managed = await readPaths()
  if (isPathManaged(path, managed)) {
    throw new ForbiddenError(
      'FIELD_MANAGED',
      `Field "${path}" is managed by your administrator's config; cannot be edited in-app.`
    )
  }
}
