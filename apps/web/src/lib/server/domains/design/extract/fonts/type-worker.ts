/**
 * The font matcher on a worker thread. Drawing a crop's words in every
 * bundled face and weight takes 0.3 to 1.5 s of CPU; here it costs this
 * thread and never the one serving requests. The brand match
 * (ai/brand-fonts.ts) starts one worker per match, hands it the text crops,
 * and stops it on the answer or at the deadline.
 */
import { parentPort } from 'node:worker_threads'
import { matchCrops, type TypeWorkerMessage, type TypeWorkerRequest } from './type-crops'

const port = parentPort
if (!port) throw new Error('The font worker runs only on a worker thread')

port.once('message', (request: TypeWorkerRequest) => {
  let message: TypeWorkerMessage
  try {
    message = { type: 'done', ok: true, matches: matchCrops(request.crops) }
  } catch {
    message = { type: 'done', ok: false }
  }
  port.postMessage(message)
})

port.postMessage({ type: 'ready' } satisfies TypeWorkerMessage)
