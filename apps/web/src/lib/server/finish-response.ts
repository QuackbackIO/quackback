/**
 * The last step before a response leaves the process, applied by the server
 * entry to the framework's final response: run any body-end hook registered
 * for it, then compress it when the client accepts compression.
 *
 * This happens here rather than in request middleware because the SSR
 * handler disposes a streamed document whose response a middleware replaced
 * (see `response-hooks.ts`); at the entry the framework has already let go.
 */
import { maybeCompress } from '@/lib/server/middleware/compression'
import { takeResponseBodyEndHook } from '@/lib/server/response-hooks'

export async function finishResponse(request: Request, response: Response): Promise<Response> {
  const hook = takeResponseBodyEndHook(response)
  const observed = hook ? withBodyEnd(response, hook) : response
  return maybeCompress(observed, request.headers.get('accept-encoding') ?? '')
}

/**
 * `response` with `done` called once its body has been read to the end. The
 * source is read only when the server pulls for more, as it would read the
 * original body.
 */
function withBodyEnd(response: Response, done: () => void): Response {
  const reader = response.body!.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done: ended, value } = await reader.read()
      if (ended) {
        controller.close()
        done()
        return
      }
      controller.enqueue(value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
  return new Response(body, response)
}
