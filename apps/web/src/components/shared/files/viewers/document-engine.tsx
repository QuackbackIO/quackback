/**
 * Word documents (.docx, .docm). The package's index is checked against the
 * zip budget, docx-preview renders it away from the page, and the sanitized
 * result is shown in a sandboxed frame as white pages on the desk. The frame
 * runs no script, so zoom re-renders its document at the new scale, and its
 * links do not navigate (people follow them from the downloaded file).
 */
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { fileExtension } from '@/lib/shared/files/file-types'
import type { EngineToolbar, ViewerEngineProps, ViewerFile } from '../types'
import { BudgetTimeoutError, checkZipBudget, withTimeout } from './budgets'
import { buildDocumentSrcdoc, renderDocumentHtml, type RenderedDocument } from './document-render'
import { ZOOM_MAX, ZOOM_MIN, clampZoom } from './zoom'

/** The desk's padding around the pages inside the frame, plus room for its scrollbar. */
const DESK_GUTTER_PX = 48

/** The zoom that fits a page into the desk, never enlarging past 100%. */
export function documentFitZoom(deskWidth: number, pageWidthPx: number): number {
  const available = deskWidth - DESK_GUTTER_PX
  if (available <= 0 || pageWidthPx <= 0) return 1
  return Math.min(1, available / pageWidthPx)
}

/** "4 pages", "Contains macros", or both. */
export function documentNote(file: Pick<ViewerFile, 'name' | 'preview'>): string | undefined {
  const parts: string[] = []
  const pages = file.preview?.pages
  if (pages) parts.push(`${pages.toLocaleString('en-US')} ${pages === 1 ? 'page' : 'pages'}`)
  if (file.preview?.macro || fileExtension(file.name) === 'docm') parts.push('Contains macros')
  return parts.length > 0 ? parts.join(' · ') : undefined
}

function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

/** Whether the app is in its dark theme (the `dark` class on the root). */
function useDarkTheme(): boolean {
  return useSyncExternalStore(
    subscribeToTheme,
    () => document.documentElement.classList.contains('dark'),
    () => false
  )
}

export default function DocumentEngine({ file, data, onToolbar, onError }: ViewerEngineProps) {
  const deskRef = useRef<HTMLDivElement>(null)
  const [rendered, setRendered] = useState<RenderedDocument | null>(null)
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(1)
  const dark = useDarkTheme()
  const fail = useEffectEvent(onError)
  const report = useEffectEvent(onToolbar)

  useEffect(() => {
    setRendered(null)
    if (!data) return
    const budget = checkZipBudget(new Uint8Array(data))
    if (!budget.ok) {
      fail(budget.failure)
      return
    }
    let cancelled = false
    withTimeout(renderDocumentHtml(data)).then(
      (doc) => {
        if (cancelled) return
        const fitted = documentFitZoom(deskRef.current?.clientWidth ?? 0, doc.pageWidthPx)
        setFit(fitted)
        setZoom(fitted)
        setRendered(doc)
      },
      (error: unknown) => {
        if (!cancelled) fail(error instanceof BudgetTimeoutError ? 'too_large' : 'corrupt')
      }
    )
    return () => {
      cancelled = true
    }
  }, [data])

  const changeZoom = useCallback((value: number) => setZoom(clampZoom(value, fit)), [fit])
  const note = documentNote(file)

  useEffect(() => {
    if (!rendered) return
    const toolbar: EngineToolbar = {
      zoom: { value: zoom, min: Math.min(ZOOM_MIN, fit), max: ZOOM_MAX, set: changeZoom },
    }
    if (note) toolbar.note = note
    report(toolbar)
  }, [rendered, zoom, fit, changeZoom, note])

  const srcdoc = useMemo(
    () => (rendered ? buildDocumentSrcdoc(rendered.html, { zoom, dark }) : null),
    [rendered, zoom, dark]
  )

  return (
    <div
      ref={deskRef}
      className="flex min-h-0 min-w-0 flex-1 bg-[oklch(0.935_0_0)] dark:bg-[oklch(0.11_0_0)]"
    >
      {srcdoc && (
        <iframe
          title={file.name}
          sandbox=""
          srcDoc={srcdoc}
          referrerPolicy="no-referrer"
          className="block min-h-0 flex-1 border-0"
        />
      )}
    </div>
  )
}
