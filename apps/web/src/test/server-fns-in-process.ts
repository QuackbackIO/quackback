/**
 * Server functions that run their handler in process and hand back what it
 * returned, as a server-side caller (a loader during a document request, or
 * another server function) gets them. Unit tests have no build step to split a
 * server function into its client and server halves, so a direct call would
 * otherwise lose the handler's result.
 *
 *   vi.mock('@tanstack/react-start', async (importOriginal) => {
 *     const { withServerFnsInProcess } = await import('@/test/server-fns-in-process')
 *     return withServerFnsInProcess(await importOriginal())
 *   })
 *
 * Input validators are skipped: the handler gets `data` as passed.
 */
export function withServerFnsInProcess<T extends object>(actual: T): T {
  const createServerFn = () => {
    const builder = {
      validator: () => builder,
      inputValidator: () => builder,
      middleware: () => builder,
      handler: (fn: (ctx: { data: unknown }) => unknown) => (opts?: { data?: unknown }) =>
        Promise.resolve().then(() => fn({ data: opts?.data })),
    }
    return builder
  }
  return { ...actual, createServerFn }
}
