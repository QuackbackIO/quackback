export {
  quackbackConfigSchema,
  parseQuackbackConfig,
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
import type { QuackbackConfigSpec } from './schema'

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
      console.error(`[config-file] file invalid: ${result.error}`)
      await deps.reportStatus?.({ kind: 'error', message: result.error })
      return
    }
    await reconcileFileIntoDb(result.config.spec, deps)
    await deps.reportStatus?.({
      kind: 'ok',
      configHash: hashSpec(result.config.spec),
    })
    console.log(`[config-file] reconciled spec from ${path}`)
  })
}

/**
 * SHA256 hex of `JSON.stringify(spec)`. Used to detect "did the file
 * change between reconciles" without shipping the spec itself.
 */
export function hashSpec(spec: QuackbackConfigSpec): string {
  return createHash('sha256').update(JSON.stringify(spec)).digest('hex')
}
