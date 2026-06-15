/**
 * Per-request log context, carried via AsyncLocalStorage.
 *
 * A single process-wide store holds request-scoped identity so the logger can
 * stamp every line (request_id, tenant_id, ...) without passing a logger down
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
  /** Workspace/tenant the request belongs to (high-cardinality; body field). */
  tenant_id?: string
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
 * Merge fields into the active context (e.g. tenant_id/user_id discovered after
 * the scope opened). No-op when called outside a request scope.
 */
export function setLogContext(partial: Partial<LogContext>): void {
  const store = storage.getStore()
  if (store) Object.assign(store, partial)
}
