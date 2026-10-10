/**
 * The spreadsheet parsing worker: one request in (the file's bytes), one
 * answer out (display text per sheet, or why it could not be read). The page
 * terminates it after the answer, on a timeout, or when the viewer moves on.
 */
import { handleSheetRequest, type SheetRequest } from './sheet-parse'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SheetRequest>) => void) | null
  postMessage: (message: unknown) => void
}

scope.onmessage = (event) => {
  scope.postMessage(handleSheetRequest(event.data))
}
