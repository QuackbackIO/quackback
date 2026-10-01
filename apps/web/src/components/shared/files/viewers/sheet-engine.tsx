/**
 * Spreadsheets and delimited text (.xlsx, .xlsm, .xls, .ods, .csv, .tsv).
 * The bytes are parsed in a worker; the page gets display text back and
 * shows it in a read-only grid. A file that takes longer than the engine
 * budget to parse is reported as too large and its worker is stopped.
 */
import { useEffect, useEffectEvent, useState } from 'react'
import { useIntl } from 'react-intl'
import type { ViewerEngineProps } from '../types'
import { ViewerSkeleton } from '../viewer-skeleton'
import { ENGINE_TIMEOUT_MS } from './budgets'
import { macroNote } from './macros'
import { isEmptySheet, sheetSourceFor, type SheetData, type SheetParseResult } from './sheet-model'
import type { SheetRequest } from './sheet-parse'
import { createSheetWorker } from './sheet-worker-client'
import { SheetView } from './sheet-view'

export default function SheetEngine({ file, data, onToolbar, onError }: ViewerEngineProps) {
  const intl = useIntl()
  const [sheets, setSheets] = useState<SheetData[] | null>(null)
  const macros = macroNote(file, intl)
  const fail = useEffectEvent(onError)

  useEffect(() => {
    setSheets(null)
    if (!data) return
    const worker = createSheetWorker()
    let settled = false
    const finish = () => {
      settled = true
      clearTimeout(timer)
      worker.terminate()
    }
    const timer = setTimeout(() => {
      if (settled) return
      finish()
      fail('too_large')
    }, ENGINE_TIMEOUT_MS)

    worker.onmessage = (event: MessageEvent<SheetParseResult>) => {
      if (settled) return
      finish()
      const result = event.data
      if (!result.ok) fail(result.failure)
      else if (result.sheets.every(isEmptySheet)) fail('empty')
      else setSheets(result.sheets)
    }
    worker.onerror = () => {
      if (settled) return
      finish()
      fail('corrupt')
    }

    // A copy goes to the worker, so the viewer keeps its bytes for Download.
    const bytes = data.slice(0)
    const request: SheetRequest = { bytes, source: sheetSourceFor(file.name, file.contentType) }
    worker.postMessage(request, [bytes])
    return finish
  }, [data, file.name, file.contentType])

  if (!sheets) return <ViewerSkeleton />
  return (
    <SheetView
      sheets={sheets}
      onNote={(note) => onToolbar({ note: macros ? `${note} · ${macros}` : note })}
    />
  )
}
