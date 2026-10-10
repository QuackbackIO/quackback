/**
 * The preview worker: one file's deriver, run on a worker thread.
 *
 * The job (`sandbox.ts`) starts one worker per file, hands it the bytes, and
 * terminates it on the answer or at the deadline, whichever comes first. A
 * parser call that cannot be interrupted (a page render, a photo decode, a
 * workbook parse) then costs this thread and never the one serving requests,
 * and never runs past the deadline.
 */
import { parentPort } from 'node:worker_threads'
import { deriveFromBytes } from './derive'
import { Deadline } from './result'
import { ownedBuffers, toWire, type DeriveRequest, type WorkerMessage } from './protocol'

const port = parentPort
if (!port) throw new Error('The preview worker runs only on a worker thread')

port.once('message', async (request: DeriveRequest) => {
  let message: WorkerMessage
  let transfer: ArrayBuffer[] = []
  try {
    const result = await deriveFromBytes(
      request.kind,
      request.bytes,
      request.contentType,
      new Deadline(request.deadlineAt - Date.now())
    )
    message = { type: 'done', ok: true, result }
    transfer = ownedBuffers((result.derived ?? []).map((d) => d.bytes))
  } catch (err) {
    message = { type: 'done', ok: false, error: toWire(err) }
  }
  port.postMessage(message, transfer)
})

port.postMessage({ type: 'ready' } satisfies WorkerMessage)
