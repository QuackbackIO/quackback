/**
 * Per-request log context, carried via AsyncLocalStorage.
 *
 * A single process-wide store holds request-scoped identity so the logger can
 * stamp every line (request_id, workspace_key, ...) without passing a logger down
 * the call stack. Because the store lives in this shared package, any consumer
 * (the web app, @quackback/db, @quackback/email) that logs within a request
 * automatically inherits the same context — that's the point of sharing it.
 *
 * Server-only: imports node:async_hooks. Never import from client/isomorphic
 * code.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export interface LogContext {
  /** Correlation id for the request; from x-request-id or generated. */
  request_id: string
  /** Low-cardinality route label, e.g. "GET /api/posts". */
  route?: string
  /** Workspace/workspace the request belongs to (high-cardinality; body field). */
  workspace_key?: string
  /** Authenticated user, once resolved. */
  user_id?: string
  /** Room for additional ambient fields without a type change. */
  [key: string]: unknown
}

const storage = new AsyncLocalStorage<LogContext>()

/** The active request context, or undefined outside a request scope. */
export function getLogContext(): LogContext | undefined {
  return storage.getStore()
}

/** Run `fn` with `context` as the ambient log context for its async subtree. */
export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run(context, fn)
}

/**
 * Merge fields into the active context (e.g. workspace_key/user_id discovered after
 * the scope opened). No-op when called outside a request scope.
 */
export function setLogContext(partial: Partial<LogContext>): void {
  const store = storage.getStore()
  if (store) Object.assign(store, partial)
}

/**
 * Run `fn` with NO ambient context, whatever is active at the call site.
 *
 * For process-lifetime work that happens to be *armed* from inside a request:
 * a `setTimeout` scheduled while serving a page inherits that request's store,
 * and so does everything the timer starts — including any `setInterval` it
 * arms, for the life of the process.
 *
 * That is not a logging nuisance. Under pooled tenancy the store also carries
 * the workspace scope, so background work armed from a request silently runs
 * forever as whichever workspace happened to be first. Detaching is the only thing
 * that makes such work fleet-wide again, and it has to happen at the boundary
 * where the work is scheduled rather than inside every consumer.
 */
export function runWithoutLogContext<T>(fn: () => T): T {
  return storage.exit(fn)
}
