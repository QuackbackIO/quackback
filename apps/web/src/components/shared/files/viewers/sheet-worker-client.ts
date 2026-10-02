/**
 * Starts the worker that parses spreadsheets off the page. Its own chunk
 * carries SheetJS and papaparse; the page only ever sees the display text it
 * posts back.
 */
export function createSheetWorker(): Worker {
  return new Worker(new URL('./sheet.worker.ts', import.meta.url), {
    type: 'module',
    name: 'sheet-parser',
  })
}
