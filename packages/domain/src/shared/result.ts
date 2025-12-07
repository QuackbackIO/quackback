/**
 * Base interface for domain errors
 */
export interface DomainError {
  code: string
  message: string
  cause?: unknown
}

/**
 * Result type for type-safe error handling
 * A discriminated union that represents either success or failure
 */
export type Result<T, E> = { success: true; value: T } | { success: false; error: E }

/**
 * Creates a successful Result
 */
export function ok<T>(value: T): Result<T, never> {
  return { success: true, value }
}

/**
 * Creates a failed Result
 */
export function err<E>(error: E): Result<never, E> {
  return { success: false, error }
}

/**
 * Type guard to check if a Result is successful
 */
export function isOk<T, E>(result: Result<T, E>): result is { success: true; value: T } {
  return result.success === true
}

/**
 * Type guard to check if a Result is an error
 */
export function isErr<T, E>(result: Result<T, E>): result is { success: false; error: E } {
  return result.success === false
}

/**
 * Unwraps a Result, throwing if it's an error
 * @throws {Error} if the result is an error
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (isOk(result)) {
    return result.value
  }
  throw new Error(`Attempted to unwrap an error result: ${JSON.stringify(result.error)}`)
}

/**
 * Unwraps a Result, returning a default value if it's an error
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (isOk(result)) {
    return result.value
  }
  return defaultValue
}

/**
 * Maps a function over the success value of a Result
 */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  if (isOk(result)) {
    return ok(fn(result.value))
  }
  return result
}

/**
 * Maps a function over the error value of a Result
 */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  if (isErr(result)) {
    return err(fn(result.error))
  }
  return result
}

/**
 * Chains Results together (also known as bind or andThen)
 * Allows sequencing operations that return Results
 */
export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  if (isOk(result)) {
    return fn(result.value)
  }
  return result
}
