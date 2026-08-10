/**
 * Per-request log context — re-exported from the shared @quackback/logger
 * package so the web app, @quackback/db and @quackback/email all share one
 * AsyncLocalStorage instance (and therefore one request_id/workspace_key scope).
 *
 * Server-only: the underlying module imports node:async_hooks.
 */
export {
  getLogContext,
  runWithLogContext,
  runWithoutLogContext,
  setLogContext,
  type LogContext,
} from '@quackback/logger'
