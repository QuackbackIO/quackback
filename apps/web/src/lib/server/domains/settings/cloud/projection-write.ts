import { isDeepStrictEqual } from 'node:util'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'

export function expectedWorkspaceKey(): string | null {
  return getCurrentWorkspace()?.workspaceKey ?? process.env.QUACKBACK_INSTANCE_ID ?? null
}

export function decideProjectionWrite<T extends { version: number }>(
  current: T | null,
  incoming: T,
  mkError: (code: 'stale_version' | 'version_conflict') => Error
): 'apply' | 'idempotent' {
  if (!current) return 'apply'
  if (incoming.version < current.version) throw mkError('stale_version')
  if (incoming.version > current.version) return 'apply'
  if (isDeepStrictEqual(incoming, current)) return 'idempotent'
  throw mkError('version_conflict')
}
