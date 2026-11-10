/**
 * The measure stage on a worker thread. Reading colours, page fill and
 * geometry and cutting the logo walks every pixel sent; here it costs this
 * thread and never the one serving requests. The brand match
 * (ai/measure-stage.ts) starts one worker per match, hands it the
 * screenshots, and stops it on the answer or at the deadline.
 */
import { parentPort } from 'node:worker_threads'
import {
  measureShots,
  measureTransfers,
  type MeasureRequest,
  type MeasureWorkerMessage,
} from './measure-shots'

const port = parentPort
if (!port) throw new Error('The measure worker runs only on a worker thread')

port.once('message', (request: MeasureRequest) => {
  let message: MeasureWorkerMessage
  let transfer: ArrayBuffer[] = []
  try {
    const measures = measureShots(request.shots, request.shots[request.primary]!)
    message = { type: 'done', ok: true, measures }
    transfer = measureTransfers(measures)
  } catch {
    message = { type: 'done', ok: false }
  }
  try {
    port.postMessage(message, transfer)
  } catch {
    port.postMessage(message)
  }
})

port.postMessage({ type: 'ready' } satisfies MeasureWorkerMessage)
