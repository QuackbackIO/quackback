/**
 * Run a file's deriver on a worker thread that is terminated at the deadline.
 *
 * Parsers run synchronously, and some calls cannot be interrupted between
 * phases (a page render, a photo decode, a workbook parse), so a deadline
 * checked in-process holds only between them, while the process's requests
 * wait. The worker checks the same deadline between phases and is terminated
 * when it passes, whatever it is doing. Its heap is capped, and each file
 * gets a fresh worker, so nothing one parse leaves behind meets the next.
 *
 * A worker that cannot start is a deployment fault (`PreviewDependencyError`,
 * the queue retries). One that dies after starting died on the file
 * (`PreviewCrashError`, the file is marked failed).
 */
import { Worker } from 'node:worker_threads'
import previewWorkerUrl from './preview-worker?server-worker'
import { fromWire, ownedBuffers, type DeriveRequest, type WorkerMessage } from './protocol'
import { PreviewDependencyError, PreviewTimeoutError, type PreviewResult } from './result'

/** Heap for one file's parse; a capped workbook read stays well inside it. */
const WORKER_HEAP_MB = 512

/** How long past the deadline the worker's own check gets to answer before it is killed. */
const KILL_GRACE_MS = 250

/** The worker died while reading the file: out of memory, or a parser that aborted. */
export class PreviewCrashError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('The preview worker stopped before answering', options)
    this.name = 'PreviewCrashError'
  }
}

export function deriveInWorker(
  request: DeriveRequest,
  options: { workerUrl?: URL } = {}
): Promise<PreviewResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(options.workerUrl ?? previewWorkerUrl, {
        resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
      })
    } catch (err) {
      reject(new PreviewDependencyError('preview worker', { cause: err }))
      return
    }

    let started = false
    let settled = false
    const settle = (outcome: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      outcome()
    }
    const died = (cause?: unknown) =>
      started
        ? new PreviewCrashError({ cause })
        : new PreviewDependencyError('preview worker', { cause })

    const timer = setTimeout(
      () => settle(() => reject(new PreviewTimeoutError())),
      Math.max(0, request.deadlineAt - Date.now()) + KILL_GRACE_MS
    )
    worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'ready') {
        started = true
        return
      }
      settle(() => (message.ok ? resolve(message.result) : reject(fromWire(message.error))))
    })
    worker.once('error', (err) => settle(() => reject(died(err))))
    worker.once('exit', (code) => settle(() => reject(died(new Error(`exit code ${code}`)))))

    // The bytes move to the worker rather than being copied.
    worker.postMessage(request, ownedBuffers([request.bytes]))
  })
}
