/**
 * A stand-in for BullMQ's `Worker` reproducing the one property under test: the
 * run loop is started by the CONSTRUCTOR, so every `await` continuation inside
 * it inherits whatever async context constructed it — and therefore so does
 * every processor invocation, whoever enqueued the job.
 *
 * Real BullMQ needs Redis, and the leak has nothing to do with Redis. What it
 * does need is a loop that is *started* in the constructor and *fed* later,
 * which is what the channel below provides. A fake that simply called the
 * processor from `deliver()` would run it on the caller's chain and reproduce
 * nothing — the first version of this file did exactly that and the test failed
 * loudly rather than passing for the wrong reason.
 */
type Processor = () => Promise<unknown> | unknown

const workers: FakeWorker[] = []

export class FakeWorker {
  private wake: (() => void) | null = null
  private queued = 0
  private done: (() => void) | null = null

  constructor(
    readonly name: string,
    private readonly processor: Processor
  ) {
    workers.push(this)
    // The run loop, started here — exactly like `Worker#run()`.
    void (async () => {
      for (;;) {
        while (this.queued > 0) {
          this.queued -= 1
          await this.processor()
          this.done?.()
          this.done = null
        }
        await new Promise<void>((r) => (this.wake = r))
      }
    })()
  }

  /** Enqueue one job and resolve once the loop has processed it. */
  deliver(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.done = resolve
      this.queued += 1
      this.wake?.()
      this.wake = null
    })
  }

  async close(): Promise<void> {}
  on(): this {
    return this
  }
}

export function resetFakeWorkers(): void {
  workers.length = 0
}

export function lastFakeWorker(): FakeWorker {
  const w = workers[workers.length - 1]
  if (!w) throw new Error('no FakeWorker was constructed')
  return w
}
