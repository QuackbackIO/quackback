/**
 * Shared failure logging for server-function handlers.
 *
 * Handlers log the action and rethrow so the error still reaches the request
 * boundary (`middleware/request-context.ts`) and the client. The message is
 * always `<action> failed`, which keeps the log line greppable by action name.
 */

/** The slice of a pino logger this helper needs, so callers can pass any child logger. */
type ErrorLogger = { error: (obj: { err: unknown }, msg: string) => void }

export async function withErrorLog<T>(
  log: ErrorLogger,
  action: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    log.error({ err: error }, `${action} failed`)
    throw error
  }
}
