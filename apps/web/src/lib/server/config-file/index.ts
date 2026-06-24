export {
  quackbackConfigSchema,
  parseQuackbackConfig,
  getDeprecatedConfigKeys,
  type QuackbackConfig,
  type QuackbackConfigSpec,
} from './schema'
export { computeManagedPaths, isPathManaged } from './managed-paths'
export { loadConfigFile, type LoadResult } from './loader'
export { watchConfigFile, type WatchOptions } from './watcher'
export {
  reconcileFileIntoDb,
  type ReconcileDeps,
  type SettingsRow,
  type SettingsUpdate,
} from './reconciler'
export { assertNotManaged } from './managed-guard'

import { createHash } from 'node:crypto'
import { watchConfigFile } from './watcher'
import { reconcileFileIntoDb } from './reconciler'
import { makeReconcileDeps } from './deps'
import { getDeprecatedConfigKeys, type QuackbackConfigSpec } from './schema'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'config-file' })

/** Default config-file path. Override via env `QUACKBACK_CONFIG_FILE`. */
const DEFAULT_PATH = '/etc/quackback/config.yaml'

/**
 * Start the file watcher + reconciler. Returns a stop fn (test/teardown
 * only).
 *
 * After every tick, `deps.reportStatus` is called with the outcome.
 * The reporter is a no-op when its env vars aren't configured.
 */
export function startQuackbackConfigWatcher(): () => void {
  const path = process.env.QUACKBACK_CONFIG_FILE ?? DEFAULT_PATH
  const deps = makeReconcileDeps()
  return watchConfigFile(path, async (result) => {
    if (result.kind === 'absent') {
      // No file present — clear any prior managed paths so the UI unlocks.
      await reconcileFileIntoDb({}, deps)
      await deps.reportStatus?.({ kind: 'absent' })
      return
    }
    if (result.kind === 'error') {
      log.error({ reason: result.error }, 'config file invalid')
      await deps.reportStatus?.({ kind: 'error', message: result.error })
      return
    }
    const deprecatedKeys = getDeprecatedConfigKeys(result.config.spec)
    const deprecatedMessage =
      deprecatedKeys.length > 0
        ? `Deprecated config key(s) ignored: ${deprecatedKeys
            .map((key) => `spec.${key}`)
            .join(', ')}. Manage these settings in-app.`
        : undefined
    if (deprecatedKeys.length > 0) {
      log.warn({ keys: deprecatedKeys }, 'config file contains deprecated ignored keys')
    }
    await reconcileFileIntoDb(result.config.spec, deps)
    await deps.reportStatus?.({
      kind: 'ok',
      configHash: hashSpec(result.config.spec),
      ...(deprecatedMessage && { message: deprecatedMessage }),
    })
    log.info({ path }, 'reconciled config spec')
  })
}

/**
 * SHA256 hex of `JSON.stringify(spec)`. Used to detect "did the file
 * change between reconciles" without shipping the spec itself.
 */
export function hashSpec(spec: QuackbackConfigSpec): string {
  return createHash('sha256').update(JSON.stringify(spec)).digest('hex')
}
