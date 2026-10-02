/**
 * The code highlighting worker: each request in (a file's text and its
 * language), one answer out under the same id (the highlighted lines, their
 * arrays transferred, or null to stay plain). The page terminates it when
 * the viewer moves on.
 */
import { handleHighlightRequest, type HighlightRequest } from './highlight-lines'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<HighlightRequest>) => void) | null
  postMessage: (message: unknown, transfer: Transferable[]) => void
}

scope.onmessage = (event) => {
  const response = handleHighlightRequest(event.data)
  const lines = response.lines
  scope.postMessage(response, lines ? [lines.starts.buffer, lines.runs.buffer] : [])
}
