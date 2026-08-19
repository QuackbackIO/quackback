/**
 * Bounded-parallel fan-out: run `fn` over `items` with at most `limit` calls
 * in flight at once. A worker-pool (not naive chunking into groups of
 * `limit` awaited one group at a time) — a slow item never blocks the next
 * item from starting the moment ANY worker frees up, where chunking would
 * instead let one slow item in a chunk hold back every fast item queued in
 * the NEXT chunk even though workers sit idle.
 *
 * `fn` is responsible for its OWN per-item error isolation: this utility does
 * not catch on the caller's behalf. Each worker is just a loop awaiting `fn`
 * directly, and all workers are joined with `Promise.all` — so a `fn` call
 * that lets a rejection propagate rejects `Promise.all` (and therefore this
 * function's own returned promise) on the FIRST such rejection, aborting the
 * batch from the caller's perspective, not isolating the failure to one
 * item or one worker. (The other in-flight workers aren't cancelled — they
 * keep running any items already claimed — but the caller no longer awaits
 * or observes them once the rejection surfaces.) Every caller in this
 * codebase that needs "one failure must not stop the batch" (see
 * workflow-sweep.ts) wraps its own per-item body in try/catch and logs,
 * mirroring dispatcher.ts's background-workflow fan-out convention.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return
  let next = 0
  async function worker(): Promise<void> {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      await fn(items[index]!, index)
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
}
