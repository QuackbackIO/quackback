/**
 * Work a settings write may only do once its transaction has committed, such
 * as refreshing what other connections read. A write that runs inside a
 * caller's transaction registers it here against that transaction; the
 * caller runs it after the commit. A write that owns its transaction runs it
 * itself, at once.
 */
import type { Database, Transaction } from '@/lib/server/db'

const pending = new WeakMap<object, Array<() => void>>()

/** Run `work` after `executor`'s transaction commits, or now when there is none. */
export function afterSettingsCommit(
  executor: Database | Transaction | undefined,
  work: () => void
): void {
  if (!executor) return work()
  const list = pending.get(executor) ?? []
  list.push(work)
  pending.set(executor, list)
}

/** Run, once, the work registered against a transaction that has committed. */
export function runAfterSettingsCommit(tx: Database | Transaction): void {
  const list = pending.get(tx)
  pending.delete(tx)
  for (const work of list ?? []) work()
}

/** Forget the work registered against a transaction that rolled back. */
export function dropAfterSettingsCommit(tx: Database | Transaction): void {
  pending.delete(tx)
}
