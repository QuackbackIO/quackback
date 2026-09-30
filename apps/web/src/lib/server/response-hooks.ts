/**
 * Work to run once a response body has been fully written.
 *
 * Request middleware must hand the framework back the response it produced.
 * The SSR handler treats a replaced response as an abandoned document and
 * disposes it, which tears down the serializer that writes a streamed
 * document's deferred data and closing tags, so the document never ends.
 * Code that needs to observe a body therefore registers here, keyed by the
 * body stream (the same identity the framework uses), and the server entry
 * applies it to the final response (`finish-response.ts`), outside the
 * middleware chain.
 *
 * No server-only imports: request middleware reaches this module from the
 * isomorphic start config.
 */

const bodyEndHooks = new WeakMap<ReadableStream<Uint8Array>, () => void>()

/** Call `hook` once `response`'s body has been read to the end. */
export function onResponseBodyEnd(response: Response, hook: () => void): void {
  if (response.body) bodyEndHooks.set(response.body, hook)
}

/** The hook registered for `response`'s body, removed as it is taken. */
export function takeResponseBodyEndHook(response: Response): (() => void) | undefined {
  if (!response.body) return undefined
  const hook = bodyEndHooks.get(response.body)
  bodyEndHooks.delete(response.body)
  return hook
}
