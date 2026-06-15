import { watch as fsWatch } from 'node:fs'
import { createHash } from 'node:crypto'
import { loadConfigFile, type LoadResult } from './loader'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'config-watcher' })

export interface WatchOptions {
  /** Polling fallback interval. Defaults to 30s — `fs.watch` on
   *  symlink-swap mounts (e.g. Kubernetes projected volumes) is
   *  unreliable, so polling backs it up. */
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
  onChange: (result: LoadResult) => void | Promise<void>,
  opts: WatchOptions = {}
): () => void {
  const interval = opts.pollIntervalMs ?? 30_000
  let lastHash: string | null = null
  let stopped = false
  let inFlight: Promise<void> | null = null
  let queued = false

  const doTick = async (): Promise<void> => {
    const result = await loadConfigFile(path)
    const hash = hashResult(result)
    if (hash === lastHash) return
    lastHash = hash
    await onChange(result)
  }

  const tick = async (): Promise<void> => {
    if (stopped) return
    // Serialize: if a tick is already running, queue at most one
    // follow-up so we don't fire concurrent reconciles. Multiple
    // overlapping triggers collapse into a single follow-up.
    if (inFlight) {
      queued = true
      return
    }
    inFlight = doTick().catch((err) => {
      // The whole pipeline (load → onChange → reconcile) bubbles errors
      // here. Without this catch they become unhandled rejections that
      // crash the Node process under default handlers. Log loudly + let
      // the next poll/native-watch tick retry.
      log.error({ err }, 'tick failed')
    })
    try {
      await inFlight
    } finally {
      inFlight = null
      if (queued && !stopped) {
        queued = false
        void tick()
      }
    }
  }

  // Initial load. Catches at the tick boundary above; this just keeps
  // the synchronous return path from holding a floating promise.
  void tick()

  // Polling fallback — guaranteed to fire even if fs.watch missed a
  // symlink swap on the mount point.
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
