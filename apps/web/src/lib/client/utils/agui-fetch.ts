/**
 * Fetch wrapper for the AG-UI client surfaces that drive a `ChatClient`
 * directly (e.g. Copilot transform). A 2xx response streams through untouched.
 * A non-2xx envelope — which the connection adapter would otherwise surface as
 * a generic "HTTP error! status:" transport throw, losing the server's own
 * message — is rewritten into a single synthetic AG-UI RUN_ERROR SSE frame so
 * the ChatClient delivers the server's coded error as a normal terminal chunk.
 * The HTTP status rides `code` as `http_<status>`, so a caller can still branch
 * on it (e.g. mapping 409 staleness to a silent skip).
 */
import { extractHttpErrorMessage } from './http-error'

/** Serialize one AG-UI `data: <json>` SSE frame (the shape
 *  `toServerSentEventsResponse` emits and `fetchServerSentEvents` parses). */
function aguiErrorFrame(code: string, message: string): string {
  return `data: ${JSON.stringify({ type: 'RUN_ERROR', code, message })}\n\n`
}

export function aguiFetchClient(): typeof fetch {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await fetch(input, init)
    if (res.ok) return res
    const message = await extractHttpErrorMessage(res)
    return new Response(aguiErrorFrame(`http_${res.status}`, message), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }
  return Object.assign(wrapped, { preconnect: fetch.preconnect })
}
