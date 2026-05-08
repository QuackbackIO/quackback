import { watch as fsWatch } from 'node:fs'
import { createHash } from 'node:crypto'
import { loadConfigFile, type LoadResult } from './loader'

export interface WatchOptions {
  /** Polling fallback interval. Defaults to 30s — kubelet auto-syncs
   *  ConfigMap mounts on a similar cadence, and `fs.watch` on
   *  symlink-swap mounts (Kubernetes projected volumes) is unreliable. */
  pollIntervalMs?: number
}

/**
 * Watch a config file for changes. Calls `onChange` once per content
 * change (deduped by sha256 of the parsed-or-error result).
 *
 * Returns a `stop` function that cancels both the native watcher and
 * the polling fallback. Idempotent on repeat calls.
 */
export function watchConfigFile(
  path: string,
  onChange: (result: LoadResult) => void,
  opts: WatchOptions = {}
): () => void {
  const interval = opts.pollIntervalMs ?? 30_000
  let lastHash: string | null = null
  let stopped = false

  const tick = async (): Promise<void> => {
    if (stopped) return
    const result = await loadConfigFile(path)
    const hash = hashResult(result)
    if (hash === lastHash) return
    lastHash = hash
    onChange(result)
  }

  // Initial load.
  void tick()

  // Polling fallback — guaranteed to fire even if fs.watch missed a
  // ConfigMap symlink swap.
  const pollHandle = setInterval(() => void tick(), interval)

  // Best-effort native watch. May fire false positives on the
  // containing directory; tick() dedupes via hash comparison.
  let nativeWatcher: ReturnType<typeof fsWatch> | undefined
  try {
    nativeWatcher = fsWatch(path, { persistent: false }, () => void tick())
    nativeWatcher.on('error', () => {
      // Path went away or unsupported FS — polling is the fallback.
    })
  } catch {
    // Path doesn't exist yet, or unsupported FS. Polling will pick up
    // the file when it appears.
  }

  return () => {
    if (stopped) return
    stopped = true
    clearInterval(pollHandle)
    nativeWatcher?.close()
  }
}

function hashResult(result: LoadResult): string {
  const h = createHash('sha256')
  h.update(result.kind)
  if (result.kind === 'ok') h.update(JSON.stringify(result.config))
  if (result.kind === 'error') h.update(result.error)
  return h.digest('hex')
}
