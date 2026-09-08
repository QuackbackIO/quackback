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

export interface DurableWork {
  workspaceKey: string
  /** Job ids inserted in this commit. Empty when the note was a wake-only signal. */
  jobIds: string[]
}

interface AfterCommitFrame {
  depth: number
  /** workspaceKey → job ids (empty set = nudge only). */
  pending: Map<string, Set<string>>
}

const frames = new AsyncLocalStorage<AfterCommitFrame>()

type DurableWorkSink = (work: DurableWork) => void

const sinks: DurableWorkSink[] = []

/** Test seam. */
export function __resetAfterCommitForTests(): void {
  sinks.length = 0
}

/**
 * Called after a durable job (or equivalent) is visible.
 *
 * The job worker registers here so an after-commit flush rings the in-process
 * scheduler (`claimById` + nudge). Cloud `ROLE=web` registers an HTTP publisher
 * instead. There is no LISTEN doorbell on the pooled worker.
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
  opts?: { committed?: boolean; jobId?: string }
): void {
  if (!workspaceKey) return
  const frame = frames.getStore()
  if (frame && frame.depth > 0) {
    let ids = frame.pending.get(workspaceKey)
    if (!ids) {
      ids = new Set()
      frame.pending.set(workspaceKey, ids)
    }
    if (opts?.jobId) ids.add(opts.jobId)
    return
  }
  if (opts?.committed === false) return
  deliver({ workspaceKey, jobIds: opts?.jobId ? [opts.jobId] : [] })
}

function clonePending(pending: Map<string, Set<string>>): Map<string, Set<string>> {
  const copy = new Map<string, Set<string>>()
  for (const [key, ids] of pending) copy.set(key, new Set(ids))
  return copy
}

function deliver(work: DurableWork): void {
  for (const sink of sinks) {
    try {
      sink(work)
    } catch (err) {
      log.error({ err, workspaceKey: work.workspaceKey }, 'after-commit sink threw')
    }
  }
}

function flushPending(pending: Map<string, Set<string>>): void {
  const entries = [...pending.entries()]
  pending.clear()
  for (const [workspaceKey, ids] of entries) {
    deliver({ workspaceKey, jobIds: [...ids] })
  }
}

/**
 * Run `fn` as one after-commit frame. The real `db.transaction` wrapper
 * calls this; tests can call it directly.
 */
export async function runInAfterCommitFrame<T>(fn: () => Promise<T>): Promise<T> {
  const parent = frames.getStore()
  if (parent) {
    const snapshot = clonePending(parent.pending)
    parent.depth += 1
    try {
      return await fn()
    } catch (err) {
      parent.pending.clear()
      for (const [key, ids] of snapshot) parent.pending.set(key, ids)
      throw err
    } finally {
      parent.depth -= 1
    }
  }

  const frame: AfterCommitFrame = { depth: 1, pending: new Map() }
  return frames.run(frame, async () => {
    try {
      const result = await fn()
      flushPending(frame.pending)
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
