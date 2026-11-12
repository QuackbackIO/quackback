import { createMiddleware } from '@tanstack/react-start'
import { liftErrorReference } from '@/lib/shared/error-reference'

/**
 * Global function middleware (registered in start.ts): when the server hid a
 * technical failure behind a plain sentence, its reference code arrives at the
 * end of the message. Lift it onto the error here, once, so every toast and
 * inline error prints the sentence alone.
 */
export const liftErrorReferenceOnFailure = createMiddleware({ type: 'function' }).client(
  async ({ next }) => {
    try {
      return await next()
    } catch (error) {
      throw liftErrorReference(error)
    }
  }
)
