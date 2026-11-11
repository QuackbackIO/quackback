/**
 * Shared HTTP-error text extraction for the assistant's client surfaces (e.g.
 * the Copilot panel's SSE turns). Pulls the
 * server's `{error:{message}}` body off a failed response, falling back to
 * one generic message so the fallback copy can never drift between surfaces.
 */

export const GENERIC_ERROR = 'Something went wrong. Try again.'

/** Pull the server's `{error:{message}}` body off a refused request, falling
 *  back to GENERIC_ERROR for a non-JSON (or empty) body and for any 5xx. */
export async function extractHttpErrorMessage(res: Response): Promise<string> {
  // A 5xx body was not written for the person: it can be a proxy's page or the
  // server's own unhandled-error envelope.
  if (res.status >= 500) return GENERIC_ERROR
  try {
    const body = await res.json()
    if (body?.error?.message) return body.error.message as string
    // The tier-limit envelope is `{ error: 'tier_limit_exceeded', message }` —
    // `error` is a string, so fall back to the top-level `message`.
    if (typeof body?.message === 'string') return body.message
  } catch {
    // Non-JSON error body: keep the generic message.
  }
  return GENERIC_ERROR
}
