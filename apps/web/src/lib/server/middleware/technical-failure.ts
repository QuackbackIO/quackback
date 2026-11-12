/**
 * Recognises failures whose message was never written for a person: a database
 * error, a network fault, a provider's reply, a bug.
 *
 * In production the browser only gets the message of a planned failure
 * (`server-fn-log.ts`). This list is the second check on those: an error that
 * carries a 4xx status, and so passes for planned, but has the shape of
 * something technical is hidden all the same.
 */
import { DomainException } from '@/lib/shared/errors'

const RUNTIME_ERROR_NAMES = new Set([
  'TypeError',
  'ReferenceError',
  'RangeError',
  'SyntaxError',
  'EvalError',
  'URIError',
  'AggregateError',
  'TimeoutError',
  'AbortError',
])

const DATABASE_ERROR_NAMES = new Set([
  'DrizzleQueryError',
  'DrizzleError',
  'TransactionRollbackError',
  'PostgresError',
])

// Drizzle words a failed statement this way, followed by the SQL and its
// values. Matched in the text too, because services wrap it ("Failed to fetch
// board: Failed query: ...").
const FAILED_QUERY = /Failed query:/

const SYSTEM_ERROR_CODE = /^E[A-Z0-9_]{2,}$/
const HTTP_CLIENT_ERROR_CODE = /^UND_ERR_/

export function isTechnicalFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return true
  if (error instanceof DomainException) return error.statusCode >= 500
  if (RUNTIME_ERROR_NAMES.has(error.name) || DATABASE_ERROR_NAMES.has(error.name)) return true
  if (FAILED_QUERY.test(error.message)) return true

  const fields = error as Error & {
    code?: unknown
    errno?: unknown
    syscall?: unknown
    status?: unknown
    headers?: unknown
  }
  if (typeof fields.code === 'string') {
    if (HTTP_CLIENT_ERROR_CODE.test(fields.code)) return true
    // Node's own faults (ECONNREFUSED, ETIMEDOUT, ENOTFOUND) carry the call
    // that failed; a hand-written error with a code of its own does not.
    if (
      SYSTEM_ERROR_CODE.test(fields.code) &&
      (typeof fields.syscall === 'string' || typeof fields.errno === 'number')
    ) {
      return true
    }
  }
  // An HTTP client's error for a provider's reply: the message quotes the
  // provider, and can quote what was sent to it.
  return typeof fields.status === 'number' && typeof fields.headers === 'object' && !!fields.headers
}

/**
 * A short code a person can read out, taken from the request id where that is
 * the usual UUID so the two agree, and random otherwise.
 */
export function newErrorReference(requestId?: unknown): string {
  const fromRequest = typeof requestId === 'string' ? requestId.replace(/[^a-z0-9]/gi, '') : ''
  const source = fromRequest.length >= 8 ? fromRequest : crypto.randomUUID().replace(/-/g, '')
  const code = source.slice(0, 8).toUpperCase()
  return `${code.slice(0, 4)}-${code.slice(4)}`
}
