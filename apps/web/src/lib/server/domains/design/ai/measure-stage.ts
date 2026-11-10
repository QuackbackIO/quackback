/**
 * The measure stage of a brand match, off the request thread. Reading the
 * colours, the page fill, the geometry and cutting the logo walks every
 * pixel of every screenshot: about a second of CPU, several under load,
 * that would hold every other request on this server. It runs on a worker
 * thread (the app's `?server-worker` mechanism), as the font stage does.
 *
 * The screenshots are copied to the worker, not transferred: the match
 * reads the same pixels again after this stage. The answer's pixel buffers
 * (the logo cut) are transferred back.
 *
 * A worker that cannot start, dies or overruns its deadline is a fault of
 * the worker, not of the screenshots: the stage then runs in process, as
 * before, and says so in the log. The answer is the same either way.
 */
import { Worker } from 'node:worker_threads'
import { logger } from '@/lib/server/logger'
import type { Shot } from './brand-measure'
import {
  measureShots,
  type MeasureRequest,
  type Measures,
  type MeasureWorkerMessage,
} from './measure-shots'
export { measureShots, type Measures } from './measure-shots'
import measureWorkerUrl from './measure-worker?server-worker'

const log = logger.child({ module: 'design-measure' })

/** Measuring is one pass over a few screenshots; the heap a worker needs for them. */
const WORKER_HEAP_MB = 512
/** Past this the worker is taken as hung and the stage runs in process. */
const DEADLINE_MS = 30_000

export type Outcome = { ok: true; measures: Measures } | { ok: false; why: 'failed' | 'late' }

/** The stage on a worker thread: its answer, or why there is none. */
export function measureInWorker(
  request: MeasureRequest,
  deadlineMs: number,
  url: URL = measureWorkerUrl
): Promise<Outcome> {
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(url, { resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } })
    } catch (err) {
      log.warn({ err }, 'measure worker could not start')
      resolve({ ok: false, why: 'failed' })
      return
    }
    let settled = false
    const settle = (outcome: Outcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      resolve(outcome)
    }
    const timer = setTimeout(() => settle({ ok: false, why: 'late' }), Math.max(0, deadlineMs))
    worker.on('message', (message: MeasureWorkerMessage) => {
      if (message.type === 'ready') return
      settle(message.ok ? { ok: true, measures: message.measures } : { ok: false, why: 'failed' })
    })
    worker.once('error', (err) => {
      log.warn({ err }, 'measure worker failed')
      settle({ ok: false, why: 'failed' })
    })
    worker.once('exit', (code) => {
      if (!settled) log.warn({ code }, 'measure worker stopped before answering')
      settle({ ok: false, why: 'failed' })
    })
    worker.postMessage(request satisfies MeasureRequest)
  })
}

/**
 * The stage's measures, taken on a worker thread; in process when the
 * worker fails or overruns `deadlineMs`.
 */
export async function measureOffThread(
  shots: readonly Shot[],
  primary: Shot,
  opts: { deadlineMs?: number; workerUrl?: URL } = {}
): Promise<Measures> {
  const at = shots.indexOf(primary)
  const outcome = await measureInWorker(
    { shots: [...shots], primary: at < 0 ? 0 : at },
    opts.deadlineMs ?? DEADLINE_MS,
    opts.workerUrl ?? measureWorkerUrl
  )
  if (outcome.ok) return outcome.measures
  log.warn({ why: outcome.why }, 'measuring in process: the worker did not answer')
  return measureShots(shots, primary)
}
