/**
 * The plain sentence people read when the server fails in a way nobody wrote a
 * message for, and the reference code that ties it to the server log line.
 *
 * A server function's thrown error reaches the browser with its message and
 * nothing else, so the reference travels at the end of the message and is
 * lifted back off in the browser (`liftErrorReference`). A client that does not
 * lift it still shows a readable sentence.
 */
export const UNEXPECTED_ERROR_MESSAGE = 'Something went wrong on our side. Try again in a moment.'

const REFERENCE_SUFFIX = /\s*\(Ref ([A-Z0-9]{4}-[A-Z0-9]{4})\)\s*$/

export function withErrorReference(message: string, reference: string): string {
  return `${message} (Ref ${reference})`
}

export function splitErrorReference(message: string): {
  message: string
  reference: string | null
} {
  const match = REFERENCE_SUFFIX.exec(message)
  if (!match) return { message, reference: null }
  return { message: message.slice(0, match.index), reference: match[1] }
}

/**
 * Moves the reference from the end of an error's message onto the error, so
 * toasts and inline errors print the sentence alone and the error page can
 * still show the code.
 */
export function liftErrorReference<T>(error: T): T {
  if (!(error instanceof Error)) return error
  const { message, reference } = splitErrorReference(error.message)
  if (!reference) return error
  error.message = message
  Object.assign(error, { reference })
  return error
}

/** The reference an error carries, lifted or still in its message. */
export function errorReferenceOf(error: unknown): string | null {
  if (error === null || typeof error !== 'object') {
    return typeof error === 'string' ? splitErrorReference(error).reference : null
  }
  const candidate = error as { reference?: unknown; message?: unknown }
  if (typeof candidate.reference === 'string') return candidate.reference
  return typeof candidate.message === 'string'
    ? splitErrorReference(candidate.message).reference
    : null
}
