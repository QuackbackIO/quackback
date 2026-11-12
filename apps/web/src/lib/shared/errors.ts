/**
 * Domain exception classes for type-safe error handling
 *
 * These exceptions replace the Result<T, E> pattern with traditional
 * throw/catch semantics while preserving structured error information.
 */

/**
 * Base class for all domain exceptions
 * Includes HTTP status code for API response mapping
 */
export abstract class DomainException extends Error {
  abstract readonly statusCode: number
  readonly code: string

  constructor(
    code: string,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.code = code
    this.name = this.constructor.name
    Error.captureStackTrace?.(this, this.constructor)
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
    }
  }
}

/**
 * HTTP 404 - Resource not found
 * Use for: *_NOT_FOUND errors
 */
export class NotFoundError extends DomainException {
  readonly statusCode = 404

  constructor(code: string, message: string, cause?: unknown) {
    super(code, message, cause)
  }
}

/**
 * HTTP 400 - Validation/bad request errors
 * Use for: VALIDATION_ERROR, INVALID_* errors
 */
export class ValidationError extends DomainException {
  readonly statusCode = 400

  constructor(code: string, message: string, cause?: unknown) {
    super(code, message, cause)
  }
}

/**
 * HTTP 403 - Forbidden/authorization errors
 * Use for: UNAUTHORIZED, *_NOT_ALLOWED, CANNOT_* errors
 */
export class ForbiddenError extends DomainException {
  readonly statusCode = 403

  constructor(code: string, message: string, cause?: unknown) {
    super(code, message, cause)
  }
}

/**
 * HTTP 409 - Conflict (duplicate resources, already exists, etc.)
 * Use for: DUPLICATE_*, ALREADY_* errors
 */
export class ConflictError extends DomainException {
  readonly statusCode = 409

  constructor(code: string, message: string, cause?: unknown) {
    super(code, message, cause)
  }
}

/**
 * HTTP 412 - A precondition the caller sent (If-Match) no longer holds
 * Use for: REVISION_MISMATCH
 */
export class PreconditionFailedError extends DomainException {
  readonly statusCode = 412

  constructor(code: string, message: string, cause?: unknown) {
    super(code, message, cause)
  }
}

/**
 * HTTP 423 - The resource is locked by its operator or a config file
 * Use for: FIELD_LOCKED
 */
export class LockedError extends DomainException {
  readonly statusCode = 423

  constructor(code: string, message: string, cause?: unknown) {
    super(code, message, cause)
  }
}

/**
 * HTTP 428 - The request must carry a precondition (If-Match)
 * Use for: IF_MATCH_REQUIRED
 */
export class PreconditionRequiredError extends DomainException {
  readonly statusCode = 428

  constructor(code: string, message: string, cause?: unknown) {
    super(code, message, cause)
  }
}

/**
 * HTTP 500 - Internal/database errors
 * Use for: DATABASE_ERROR, unexpected failures
 */
export class InternalError extends DomainException {
  readonly statusCode = 500

  constructor(code: string, message: string, cause?: unknown) {
    super(code, message, cause)
  }
}

/**
 * HTTP 401 - Authentication required
 * Use for: missing/invalid API key (auth layer only, not domain-level permission checks)
 */
export class UnauthorizedError extends DomainException {
  readonly statusCode = 401

  constructor(message: string, cause?: unknown) {
    super('API_UNAUTHORIZED', message, cause)
  }
}

/**
 * HTTP 429 - Rate limit exceeded
 */
export class RateLimitError extends DomainException {
  readonly statusCode = 429
  readonly retryAfter: number

  constructor(retryAfter: number, cause?: unknown) {
    super('RATE_LIMITED', 'Too many requests. Please try again later.', cause)
    this.retryAfter = retryAfter
  }
}

/**
 * HTTP 503 - something on our side or a provider's failed, and the message was
 * written for the person who hit it ("Couldn't reach the mail provider. Try
 * again in a minute.").
 *
 * In production every other 5xx reaches the browser as a plain sentence with a
 * reference code (`server-fn-log.ts`). This class is the way to say "show this
 * one as written", so never build its message from an upstream reply, a query
 * or anything else that was not authored here. A status code may be included.
 */
export class ServiceUnavailableError extends DomainException {
  readonly statusCode = 503
  readonly safeToShow = true

  constructor(code: string, message: string, cause?: unknown) {
    super(code, message, cause)
  }
}

/**
 * Whether a failure on our side carries a message written for people. Read
 * structurally so an error class outside this file can opt in with a
 * `safeToShow = true` field.
 */
export function isSafeToShow(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    (error as { safeToShow?: unknown }).safeToShow === true
  )
}
