import '@testing-library/jest-dom'
import { AsyncLocalStorage } from 'node:async_hooks'

// Since @tanstack/react-start 1.168, executing a createServerFn runs the global
// request middleware, which reads the "Start context" from an AsyncLocalStorage
// keyed by this well-known global Symbol. Outside the server runtime (i.e. unit
// tests that call a server function directly, as the docs show) that store is
// empty and getStartContext() throws "No Start context found in AsyncLocalStorage".
//
// Seed the framework's own ALS (it guards creation with `if (!exists)`, so it
// reuses this instance) and make getStore() fall back to an empty context when
// none is active. Empty requestMiddleware means the app's global CSRF/logging
// middleware does not run in unit tests; a real server context still wins.
{
  const KEY = Symbol.for('tanstack-start:start-storage-context')
  const g = globalThis as unknown as Record<symbol, unknown>
  if (!g[KEY]) {
    const als = new AsyncLocalStorage<unknown>()
    const getStore = als.getStore.bind(als)
    als.getStore = () => getStore() ?? { startOptions: { requestMiddleware: [] } }
    g[KEY] = als
  }
}
