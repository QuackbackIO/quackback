/**
 * Suspension guard — server-only chokepoint helper for declarative
 * workspace suspension.
 *
 * `settings.state` carries the trinary 'active' | 'suspended' |
 * 'deleting' and is written by the config-file reconciler. With no
 * config file present, the column stays at its 'active' DB default and
 * this guard is a no-op for every request.
 *
 * The pure half (`isSuspensionExempt` + `SUSPENSION_EXEMPT_PATHS`)
 * lives in `./suspension-paths.ts` so `__root.tsx` can import the
 * exempt-path check without dragging Redis/settings.service into the
 * client bundle. Re-exported here as a convenience for server-side
 * callers that want one import surface.
 *
 * The `_internal` form takes an injected `readState` so unit tests
 * stay free of DB / cache imports.
 */
import { DomainException } from '@/lib/shared/errors'

export { SUSPENSION_EXEMPT_PATHS, isSuspensionExempt } from './suspension-paths'

/** HTTP 402 — Payment Required. The workspace stays read-blocked
 *  until something clears the suspended state. */
export class SuspendedError extends DomainException {
  readonly statusCode = 402
  constructor() {
    super('WORKSPACE_SUSPENDED', 'Workspace is currently unavailable.')
  }
}

/** HTTP 410 — Gone. The workspace is being deleted; data may be
 *  partially purged and no further writes are accepted. */
export class DeletingError extends DomainException {
  readonly statusCode = 410
  constructor() {
    super('WORKSPACE_DELETING', 'Workspace is being deleted.')
  }
}

/**
 * Block the current request when the workspace isn't active.
 *
 * Lazy-imports `getTenantSettings` to keep this module out of the
 * client bundle and so call-sites in cold paths don't pay the cost
 * unless they actually invoke the guard.
 */
export async function ensureNotSuspended(): Promise<void> {
  const { getTenantSettings } = await import('@/lib/server/domains/settings/settings.service')
  await _internalEnsureNotSuspended(async () => {
    const s = await getTenantSettings()
    return (s?.state ?? 'active') as 'active' | 'suspended' | 'deleting'
  })
}

/** Test seam — accepts an injected reader so the unit tests stay
 *  free of DB / Redis imports. */
export async function _internalEnsureNotSuspended(
  readState: () => Promise<'active' | 'suspended' | 'deleting'>
): Promise<void> {
  const state = await readState()
  if (state === 'suspended') throw new SuspendedError()
  if (state === 'deleting') throw new DeletingError()
}
