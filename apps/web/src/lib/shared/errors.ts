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
 * HTTP 500 - Internal/database errors
 * Use for: DATABASE_ERROR, unexpected failures
 */
export class InternalError extends DomainException {
  readonly statusCode = 500

  constructor(code: string, message: string, cause?: unknown) {
    super(code, message, cause)
  }
}
