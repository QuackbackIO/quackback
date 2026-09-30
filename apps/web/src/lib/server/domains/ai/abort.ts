/**
 * `chat()` takes an AbortController, not a signal. This links one to a
 * caller's signal, so aborting the signal cancels the in-flight provider call.
 */
export function abortControllerFor(signal: AbortSignal | undefined): AbortController | undefined {
  if (!signal) return undefined
  const controller = new AbortController()
  if (signal.aborted) controller.abort(signal.reason)
  else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  return controller
}
