import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Run a server-function call inside a minimal TanStack Start context.
 *
 * Since @tanstack/react-start 1.168, executing a `createServerFn` runs the
 * global request middleware, which reads the "Start context" from an
 * AsyncLocalStorage. Outside the server runtime (i.e. in unit tests that invoke
 * a server function directly) that store is empty and the call throws
 * "No Start context found in AsyncLocalStorage".
 *
 * This wraps the call in a context whose `requestMiddleware` is empty, so the
 * function's own validator + handler run in isolation without the app's global
 * CSRF/logging middleware. We reach the framework's ALS via its well-known
 * global Symbol (a stable contract; both sides guard creation with `if (!exists)`),
 * rather than importing the internal @tanstack/start-storage-context package,
 * which isn't resolvable as a bare import under the workspace's module layout.
 */
const STORAGE_KEY = Symbol.for('tanstack-start:start-storage-context')

function getStartStorage(): AsyncLocalStorage<unknown> {
  const g = globalThis as unknown as Record<symbol, unknown>
  if (!g[STORAGE_KEY]) g[STORAGE_KEY] = new AsyncLocalStorage<unknown>()
  return g[STORAGE_KEY] as AsyncLocalStorage<unknown>
}

export function withStartContext<T>(fn: () => Promise<T>): Promise<T> {
  return getStartStorage().run({ startOptions: { requestMiddleware: [] } }, fn)
}
