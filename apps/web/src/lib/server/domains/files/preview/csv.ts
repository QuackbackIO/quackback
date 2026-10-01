/**
 * Delimited text (.csv, .tsv): the first rows parsed for the card's mini
 * grid, and a row count from the line breaks of the whole file. A quoted
 * field with a line break in it counts twice; the count stays cheap.
 */
import Papa from 'papaparse'
import { cell, normalizeExcerpt, type PreviewResult } from './result'
import { countLines } from './text'

const HEAD_BYTES = 256 * 1024
const HEAD_ROWS = 6
const HEAD_COLUMNS = 8
const CELL_CHARS = 40

export async function deriveCsvPreview(bytes: Uint8Array): Promise<PreviewResult> {
  const text = new TextDecoder().decode(bytes.subarray(0, HEAD_BYTES))
  const parsed = Papa.parse<string[]>(text, { preview: HEAD_ROWS, skipEmptyLines: true })
  const head = parsed.data.map((row) => row.slice(0, HEAD_COLUMNS).map((v) => cell(v, CELL_CHARS)))
  const rows = countLines(bytes)
  return {
    status: 'ready',
    meta: { ...(rows > 0 ? { rows } : {}), ...(head.length ? { head } : {}) },
    excerpt: normalizeExcerpt(text),
  }
}
