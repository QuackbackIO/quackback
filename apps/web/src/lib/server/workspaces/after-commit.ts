/**
 * After-commit workspace signaling.
 *
 * A job inserted on the caller's transaction is not visible to another
 * connection until that transaction commits. Signaling the scheduler
 * before commit can inspect an empty queue and go back to sleep — or
 * fire for a row that then rolls back.
 *
 * `db.transaction` is wrapped so every outer commit flushes the workspace
 * keys recorded during that transaction. Rollback discards them. Nested
 * `db.transaction` calls are savepoints: an inner throw restores the
 * pending set to the snapshot taken on entry.
 *
 * Enqueue outside a wrapped transaction is already committed, so it
 * delivers immediately.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'after-commit' })

/** Sentinel used when a single-workspace install has no ambient scope. */
export const SINGLE_WORKSPACE_KEY = '__single__'

interface AfterCommitFrame {
  depth: number
  pending: Set<string>
}

const frames = new AsyncLocalStorage<AfterCommitFrame>()

type DurableWorkSink = (workspaceKey: string) => void

const sinks: DurableWorkSink[] = []

/** Test seam. */
export function __resetAfterCommitForTests(): void {
  sinks.length = 0
}

/**
 * Called after a durable job (or equivalent) is visible.
 *
 * The job tier registers here so an after-commit flush rings the in-process
 * scheduler. Cloud and self-host `ROLE=all` both use this path; there is no
 * cross-process HTTP nudge.
 */
export function onDurableWorkCommitted(sink: DurableWorkSink): () => void {
  sinks.push(sink)
  return () => {
    const i = sinks.indexOf(sink)
    if (i >= 0) sinks.splice(i, 1)
  }
}

export function noteDurableWork(
  workspaceKey: string | null | undefined,
  opts?: { committed?: boolean }
): void {
  if (!workspaceKey) return
  const frame = frames.getStore()
  if (frame && frame.depth > 0) {
    frame.pending.add(workspaceKey)
    return
  }
  if (opts?.committed === false) return
  deliver(workspaceKey)
}

function deliver(workspaceKey: string): void {
  for (const sink of sinks) {
    try {
      sink(workspaceKey)
    } catch (err) {
      log.error({ err, workspaceKey }, 'after-commit sink threw')
    }
  }
}

/**
 * Run `fn` as one after-commit frame. The real `db.transaction` wrapper
 * calls this; tests can call it directly.
 */
export async function runInAfterCommitFrame<T>(fn: () => Promise<T>): Promise<T> {
  const parent = frames.getStore()
  if (parent) {
    const snapshot = new Set(parent.pending)
    parent.depth += 1
    try {
      return await fn()
    } catch (err) {
      parent.pending.clear()
      for (const key of snapshot) parent.pending.add(key)
      throw err
    } finally {
      parent.depth -= 1
    }
  }

  const frame: AfterCommitFrame = { depth: 1, pending: new Set() }
  return frames.run(frame, async () => {
    try {
      const result = await fn()
      const keys = [...frame.pending]
      frame.pending.clear()
      for (const key of keys) deliver(key)
      return result
    } catch (err) {
      frame.pending.clear()
      throw err
    }
  })
}

/** Bind a drizzle `transaction` method so its commit flushes pending work. */
export function wrapDbTransaction<TArgs extends unknown[], TResult>(
  transaction: (...args: TArgs) => TResult
): (...args: TArgs) => TResult {
  return ((...args: TArgs) => runInAfterCommitFrame(async () => await transaction(...args))) as (
    ...args: TArgs
  ) => TResult
}
